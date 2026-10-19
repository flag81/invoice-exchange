/**
 * The exchange state machine (§4.5).
 *
 * It is the interaction half of the invoice: who has been asked to do something, and what they answered.
 * Every row here has a counterpart in `invoicing/transitions.ts`, and `exchangeStatusForInvoice` in
 * `projection.ts` is the written-down mapping between them — the invoice track stays authoritative for
 * issuing, cancelling and paying.
 *
 * The supplier may withdraw an invoice from the exchange at any point before the buyer decides; the buyer
 * may accept, dispute (with a reason, which is mandatory and goes to the audit trail) or reject a dispute.
 */

import { DomainErrorCode, fail, isDomainError } from '../errors';
import { PartyRole } from '../invoicing/parties';
import { ExchangeStatus } from './status';

export const ExchangeAction = {
  /** PENDING → SENT: the invoice is in front of the buyer. */
  SEND: 'SEND',
  /** SENT → VIEWED. */
  VIEW: 'VIEW',
  /** VIEWED → ACCEPTED. */
  ACCEPT: 'ACCEPT',
  /** VIEWED → DISPUTED. Requires a reason. */
  DISPUTE: 'DISPUTE',
  /** DISPUTED → ACCEPTED: the dispute was resolved in favour of the invoice. */
  RESOLVE_ACCEPT: 'RESOLVE_ACCEPT',
  /** DISPUTED → REJECTED: the dispute was resolved against the invoice. */
  RESOLVE_REJECT: 'RESOLVE_REJECT',
  /** PENDING, SENT or VIEWED → CANCELLED: withdrawn before the buyer decided. */
  WITHDRAW: 'WITHDRAW',
} as const;

export type ExchangeAction = (typeof ExchangeAction)[keyof typeof ExchangeAction];

export const EXCHANGE_ACTIONS: readonly ExchangeAction[] = Object.values(ExchangeAction);

export function isExchangeAction(value: unknown): value is ExchangeAction {
  return typeof value === 'string' && (EXCHANGE_ACTIONS as readonly string[]).includes(value);
}

export type ExchangeTransition = {
  readonly action: ExchangeAction;
  readonly from: ExchangeStatus;
  readonly to: ExchangeStatus;
  readonly actors: readonly PartyRole[];
  readonly reasonRequired?: boolean;
};

const SUPPLIER_ONLY: readonly PartyRole[] = [PartyRole.SUPPLIER];
const BUYER_ONLY: readonly PartyRole[] = [PartyRole.BUYER];
const BOTH_SIDES: readonly PartyRole[] = [PartyRole.BUYER, PartyRole.SUPPLIER];

export const EXCHANGE_TRANSITIONS: readonly ExchangeTransition[] = [
  {
    action: ExchangeAction.SEND,
    from: ExchangeStatus.PENDING,
    to: ExchangeStatus.SENT,
    actors: SUPPLIER_ONLY,
  },
  {
    action: ExchangeAction.VIEW,
    from: ExchangeStatus.SENT,
    to: ExchangeStatus.VIEWED,
    actors: BOTH_SIDES,
  },
  {
    action: ExchangeAction.ACCEPT,
    from: ExchangeStatus.VIEWED,
    to: ExchangeStatus.ACCEPTED,
    actors: BUYER_ONLY,
  },
  {
    action: ExchangeAction.DISPUTE,
    from: ExchangeStatus.VIEWED,
    to: ExchangeStatus.DISPUTED,
    actors: BUYER_ONLY,
    reasonRequired: true,
  },
  {
    action: ExchangeAction.RESOLVE_ACCEPT,
    from: ExchangeStatus.DISPUTED,
    to: ExchangeStatus.ACCEPTED,
    actors: BUYER_ONLY,
  },
  {
    action: ExchangeAction.RESOLVE_REJECT,
    from: ExchangeStatus.DISPUTED,
    to: ExchangeStatus.REJECTED,
    actors: BUYER_ONLY,
  },
  {
    action: ExchangeAction.WITHDRAW,
    from: ExchangeStatus.PENDING,
    to: ExchangeStatus.CANCELLED,
    actors: SUPPLIER_ONLY,
  },
  {
    action: ExchangeAction.WITHDRAW,
    from: ExchangeStatus.SENT,
    to: ExchangeStatus.CANCELLED,
    actors: SUPPLIER_ONLY,
  },
  {
    action: ExchangeAction.WITHDRAW,
    from: ExchangeStatus.VIEWED,
    to: ExchangeStatus.CANCELLED,
    actors: SUPPLIER_ONLY,
  },
];

export function exchangeTransitionsFrom(from: ExchangeStatus): readonly ExchangeTransition[] {
  return EXCHANGE_TRANSITIONS.filter((transition) => transition.from === from);
}

export function findExchangeTransition(
  from: ExchangeStatus,
  action: ExchangeAction,
): ExchangeTransition | undefined {
  return EXCHANGE_TRANSITIONS.find(
    (transition) => transition.from === from && transition.action === action,
  );
}

export type ExchangeTransitionRequest = {
  readonly from: ExchangeStatus;
  readonly action: ExchangeAction;
  readonly actor: PartyRole;
  readonly reason?: string;
};

/** Same three failure modes as the invoice table: unknown move, wrong side, missing reason. */
export function assertExchangeTransition(request: ExchangeTransitionRequest): ExchangeTransition {
  const transition = findExchangeTransition(request.from, request.action);

  if (transition === undefined) {
    fail(
      DomainErrorCode.STATE_CONFLICT,
      `an exchange in ${request.from} cannot be ${request.action}`,
      { from: request.from, action: request.action },
    );
  }

  if (!transition.actors.includes(request.actor)) {
    fail(
      DomainErrorCode.PERMISSION_DENIED,
      `only ${transition.actors.join(' or ')} may ${request.action} an exchange in ${request.from}`,
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

export function canApplyExchangeTransition(request: ExchangeTransitionRequest): boolean {
  try {
    assertExchangeTransition(request);
    return true;
  } catch (error) {
    if (isDomainError(error)) {
      return false;
    }

    throw error;
  }
}

export function nextExchangeStatus(request: ExchangeTransitionRequest): ExchangeStatus {
  return assertExchangeTransition(request).to;
}
