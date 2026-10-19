/**
 * The invoice state machine: every legal move, in one table (§4.5).
 *
 * Invariant 4 of §4.3 says it plainly — *every* status transition is present in this file and anything
 * not in the table throws. That is why the machine is data (a `readonly` array) rather than a set of
 * `if` statements: the API, the UI, the audit trail and the tests all read the same rows, and a new
 * transition is one line that the exhaustive test then forces to be reflected everywhere.
 *
 * Two rules from §4.5 shape the table:
 *
 * - **Who may act.** Only the supplier may issue, send, cancel or mark paid; only the buyer may accept,
 *   dispute or reject. `MARK_DELIVERED` accepts either side on purpose: the buyer moving it by viewing
 *   it and the supplier recording an emailed PDF are both true statements of the same fact.
 * - **A dispute carries a reason.** It is part of the audit record and it is emailed, so the table marks
 *   it `reasonRequired` and `assertInvoiceTransition` refuses a blank one.
 *
 * Cancellation is allowed up to and including `DELIVERED` — the point of no return is the buyer's
 * decision. After `ACCEPTED` the correction path is a credit note, which is a document of its own and
 * leaves the invoice untouched (`canIssueCreditNote`).
 */

import { DomainErrorCode, fail, isDomainError } from '../errors';
import { PartyRole } from './parties';
import { InvoiceStatus } from './status';

export const InvoiceAction = {
  /** DRAFT → ISSUED: assign the number, lock the header, snapshot version 1. */
  ISSUE: 'ISSUE',
  /** ISSUED → SENT: hand the document to the buyer. */
  SEND: 'SEND',
  /** SENT → DELIVERED: the buyer has seen it. */
  MARK_DELIVERED: 'MARK_DELIVERED',
  /** DELIVERED or DISPUTED → ACCEPTED. */
  ACCEPT: 'ACCEPT',
  /** DELIVERED → DISPUTED. Requires a reason. */
  DISPUTE: 'DISPUTE',
  /** DISPUTED → REJECTED: the dispute ends in a refusal. */
  REJECT: 'REJECT',
  /** ACCEPTED → PAID: the money arrived. */
  MARK_PAID: 'MARK_PAID',
  /** DRAFT, ISSUED, SENT or DELIVERED → CANCELLED. */
  CANCEL: 'CANCEL',
} as const;

export type InvoiceAction = (typeof InvoiceAction)[keyof typeof InvoiceAction];

export const INVOICE_ACTIONS: readonly InvoiceAction[] = Object.values(InvoiceAction);

export function isInvoiceAction(value: unknown): value is InvoiceAction {
  return typeof value === 'string' && (INVOICE_ACTIONS as readonly string[]).includes(value);
}

export type InvoiceTransition = {
  readonly action: InvoiceAction;
  readonly from: InvoiceStatus;
  readonly to: InvoiceStatus;
  readonly actors: readonly PartyRole[];
  /** A `reason` is mandatory and must be non-blank. */
  readonly reasonRequired?: boolean;
};

const SUPPLIER_ONLY: readonly PartyRole[] = [PartyRole.SUPPLIER];
const BUYER_ONLY: readonly PartyRole[] = [PartyRole.BUYER];

/** Both sides: a buyer viewing the invoice, or a supplier recording that an emailed PDF arrived. */
const BOTH_SIDES: readonly PartyRole[] = [PartyRole.BUYER, PartyRole.SUPPLIER];

export const INVOICE_TRANSITIONS: readonly InvoiceTransition[] = [
  {
    action: InvoiceAction.ISSUE,
    from: InvoiceStatus.DRAFT,
    to: InvoiceStatus.ISSUED,
    actors: SUPPLIER_ONLY,
  },
  {
    action: InvoiceAction.CANCEL,
    from: InvoiceStatus.DRAFT,
    to: InvoiceStatus.CANCELLED,
    actors: SUPPLIER_ONLY,
  },
  {
    action: InvoiceAction.SEND,
    from: InvoiceStatus.ISSUED,
    to: InvoiceStatus.SENT,
    actors: SUPPLIER_ONLY,
  },
  {
    action: InvoiceAction.CANCEL,
    from: InvoiceStatus.ISSUED,
    to: InvoiceStatus.CANCELLED,
    actors: SUPPLIER_ONLY,
  },
  {
    action: InvoiceAction.MARK_DELIVERED,
    from: InvoiceStatus.SENT,
    to: InvoiceStatus.DELIVERED,
    actors: BOTH_SIDES,
  },
  {
    action: InvoiceAction.CANCEL,
    from: InvoiceStatus.SENT,
    to: InvoiceStatus.CANCELLED,
    actors: SUPPLIER_ONLY,
  },
  {
    action: InvoiceAction.CANCEL,
    from: InvoiceStatus.DELIVERED,
    to: InvoiceStatus.CANCELLED,
    actors: SUPPLIER_ONLY,
  },
  {
    action: InvoiceAction.ACCEPT,
    from: InvoiceStatus.DELIVERED,
    to: InvoiceStatus.ACCEPTED,
    actors: BUYER_ONLY,
  },
  {
    action: InvoiceAction.DISPUTE,
    from: InvoiceStatus.DELIVERED,
    to: InvoiceStatus.DISPUTED,
    actors: BUYER_ONLY,
    reasonRequired: true,
  },
  {
    action: InvoiceAction.ACCEPT,
    from: InvoiceStatus.DISPUTED,
    to: InvoiceStatus.ACCEPTED,
    actors: BUYER_ONLY,
  },
  {
    action: InvoiceAction.REJECT,
    from: InvoiceStatus.DISPUTED,
    to: InvoiceStatus.REJECTED,
    actors: BUYER_ONLY,
  },
  {
    action: InvoiceAction.MARK_PAID,
    from: InvoiceStatus.ACCEPTED,
    to: InvoiceStatus.PAID,
    actors: SUPPLIER_ONLY,
  },
];

/** Statuses a credit note may correct (§4.5). The invoice keeps its status and its number. */
export const CREDIT_NOTE_ALLOWED_FROM: readonly InvoiceStatus[] = [
  InvoiceStatus.ISSUED,
  InvoiceStatus.SENT,
  InvoiceStatus.DELIVERED,
  InvoiceStatus.ACCEPTED,
  InvoiceStatus.DISPUTED,
];

export function canIssueCreditNote(status: InvoiceStatus): boolean {
  return CREDIT_NOTE_ALLOWED_FROM.includes(status);
}

/** Everything that can happen next, for one status — what the UI renders as available actions. */
export function transitionsFrom(from: InvoiceStatus): readonly InvoiceTransition[] {
  return INVOICE_TRANSITIONS.filter((transition) => transition.from === from);
}

export function findInvoiceTransition(
  from: InvoiceStatus,
  action: InvoiceAction,
): InvoiceTransition | undefined {
  return INVOICE_TRANSITIONS.find(
    (transition) => transition.from === from && transition.action === action,
  );
}

export type InvoiceTransitionRequest = {
  readonly from: InvoiceStatus;
  readonly action: InvoiceAction;
  readonly actor: PartyRole;
  /** Required by `DISPUTE`; recorded in the audit event when present. */
  readonly reason?: string;
};

/**
 * Applies the table, or throws the rule that was broken:
 *
 * - no row for `(from, action)` → `STATE_CONFLICT` (the state does not allow it; this is also how every
 *   terminal status rejects every action);
 * - the row exists but the actor is on the wrong side → `PERMISSION_DENIED`;
 * - the row needs a reason and `reason` is missing or blank → `REASON_REQUIRED`.
 */
export function assertInvoiceTransition(request: InvoiceTransitionRequest): InvoiceTransition {
  const transition = findInvoiceTransition(request.from, request.action);

  if (transition === undefined) {
    fail(
      DomainErrorCode.STATE_CONFLICT,
      `an invoice in ${request.from} cannot be ${request.action}`,
      {
        from: request.from,
        action: request.action,
      },
    );
  }

  if (!transition.actors.includes(request.actor)) {
    fail(
      DomainErrorCode.PERMISSION_DENIED,
      `only ${transition.actors.join(' or ')} may ${request.action} an invoice in ${request.from}`,
      {
        from: request.from,
        action: request.action,
        actor: request.actor,
        allowedActors: transition.actors.join(', '),
      },
    );
  }

  if (transition.reasonRequired === true && (request.reason ?? '').trim() === '') {
    fail(DomainErrorCode.REASON_REQUIRED, `${request.action} requires a reason`, {
      from: request.from,
      action: request.action,
    });
  }

  return transition;
}

/**
 * The same question as `assertInvoiceTransition`, asked without exceptions — the UI needs a `boolean`
 * and the use-case needs the throw. Only *domain* failures become `false`; anything else is a bug and is
 * re-thrown rather than reported as "not allowed".
 */
export function canApplyInvoiceTransition(request: InvoiceTransitionRequest): boolean {
  try {
    assertInvoiceTransition(request);
    return true;
  } catch (error) {
    if (isDomainError(error)) {
      return false;
    }

    throw error;
  }
}

/** The resulting status, so a caller never has to remember which action leads where. */
export function nextInvoiceStatus(request: InvoiceTransitionRequest): InvoiceStatus {
  return assertInvoiceTransition(request).to;
}
