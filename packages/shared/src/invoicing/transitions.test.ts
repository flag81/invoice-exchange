import { describe, expect, it } from 'vitest';

import {
  DomainErrorCode,
  INVOICE_ACTIONS,
  INVOICE_STATUSES,
  INVOICE_TRANSITIONS,
  InvoiceAction,
  InvoiceStatus,
  PARTY_ROLES,
  PartyRole,
  assertInvoiceTransition,
  canApplyInvoiceTransition,
  canIssueCreditNote,
  findInvoiceTransition,
  isTerminalInvoiceStatus,
  isInvoiceAction,
  nextInvoiceStatus,
  transitionsFrom,
} from '../index';
import { expectDomainError } from '../testing/domain-error';

const REASON = 'the quantities do not match the delivery note';

const FINAL: readonly InvoiceStatus[] = [
  InvoiceStatus.PAID,
  InvoiceStatus.REJECTED,
  InvoiceStatus.CANCELLED,
];

describe('the invoice transition table (§4.5)', () => {
  it('decides every status × action × actor triple, and refuses the rest', () => {
    for (const from of INVOICE_STATUSES) {
      for (const action of INVOICE_ACTIONS) {
        for (const actor of PARTY_ROLES) {
          const request = { from, action, actor, reason: REASON };
          const row = findInvoiceTransition(from, action);

          if (row === undefined) {
            expectDomainError(
              () => assertInvoiceTransition(request),
              DomainErrorCode.STATE_CONFLICT,
            );
            expect(canApplyInvoiceTransition(request)).toBe(false);
            continue;
          }

          if (!row.actors.includes(actor)) {
            expectDomainError(
              () => assertInvoiceTransition(request),
              DomainErrorCode.PERMISSION_DENIED,
            );
            expect(canApplyInvoiceTransition(request)).toBe(false);
            continue;
          }

          expect(assertInvoiceTransition(request)).toBe(row);
          expect(nextInvoiceStatus(request)).toBe(row.to);
          expect(canApplyInvoiceTransition(request)).toBe(true);
        }
      }
    }
  });

  it('gives every action a home, and no two rows the same (from, action)', () => {
    for (const action of INVOICE_ACTIONS) {
      expect(INVOICE_TRANSITIONS.some((row) => row.action === action)).toBe(true);
    }

    const keys = INVOICE_TRANSITIONS.map((row) => `${row.from}/${row.action}`);

    expect(keys).toHaveLength(12);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('names the acting side on every row, and only sides that exist', () => {
    for (const row of INVOICE_TRANSITIONS) {
      expect(row.actors.length).toBeGreaterThan(0);
      expect(INVOICE_STATUSES).toContain(row.from);
      expect(INVOICE_STATUSES).toContain(row.to);

      for (const actor of row.actors) {
        expect(PARTY_ROLES).toContain(actor);
      }
    }
  });

  it('splits the same rows into per-status menus that add back up to the table', () => {
    const menus = INVOICE_STATUSES.flatMap((status) => transitionsFrom(status));

    expect(menus).toHaveLength(INVOICE_TRANSITIONS.length);

    for (const status of INVOICE_STATUSES) {
      for (const row of transitionsFrom(status)) {
        expect(row.from).toBe(status);
      }
    }

    expect(transitionsFrom(InvoiceStatus.DRAFT).map((row) => row.action)).toEqual([
      InvoiceAction.ISSUE,
      InvoiceAction.CANCEL,
    ]);
    expect(transitionsFrom(InvoiceStatus.SENT).map((row) => row.action)).toEqual([
      InvoiceAction.MARK_DELIVERED,
      InvoiceAction.CANCEL,
    ]);
    expect(transitionsFrom(InvoiceStatus.ACCEPTED).map((row) => row.action)).toEqual([
      InvoiceAction.MARK_PAID,
    ]);
  });

  it('walks the whole happy path, one row at a time, and stops at PAID', () => {
    let status: InvoiceStatus = InvoiceStatus.DRAFT;
    const steps = [
      { action: InvoiceAction.ISSUE, actor: PartyRole.SUPPLIER },
      { action: InvoiceAction.SEND, actor: PartyRole.SUPPLIER },
      { action: InvoiceAction.MARK_DELIVERED, actor: PartyRole.SUPPLIER },
      { action: InvoiceAction.ACCEPT, actor: PartyRole.BUYER },
      { action: InvoiceAction.MARK_PAID, actor: PartyRole.SUPPLIER },
    ];

    for (const step of steps) {
      status = nextInvoiceStatus({ from: status, action: step.action, actor: step.actor });
    }

    expect(status).toBe(InvoiceStatus.PAID);
    expect(isTerminalInvoiceStatus(status)).toBe(true);
  });
});

describe('the reason a dispute carries', () => {
  const dispute = {
    from: InvoiceStatus.DELIVERED,
    action: InvoiceAction.DISPUTE,
    actor: PartyRole.BUYER,
  };

  it('is mandatory on DISPUTE, and a blank one is the same as no reason at all', () => {
    const applied = assertInvoiceTransition({ ...dispute, reason: 'wrong quantities' });

    expect(applied.to).toBe(InvoiceStatus.DISPUTED);
    expect(applied.reasonRequired).toBe(true);

    for (const reason of [undefined, '', ' ', '\t\n']) {
      expectDomainError(
        () => assertInvoiceTransition({ ...dispute, reason }),
        DomainErrorCode.REASON_REQUIRED,
      );
      expect(canApplyInvoiceTransition({ ...dispute, reason })).toBe(false);
    }
  });

  it('is never demanded by a row that does not ask for it', () => {
    for (const row of INVOICE_TRANSITIONS) {
      if (row.reasonRequired === true) {
        continue;
      }

      for (const actor of row.actors) {
        expect(assertInvoiceTransition({ from: row.from, action: row.action, actor })).toBe(row);
      }
    }
  });

  it('lets the dispute end in a refusal: delivered → disputed → rejected', () => {
    const disputed = nextInvoiceStatus({ ...dispute, reason: 'wrong quantities' });
    const rejected = nextInvoiceStatus({
      from: disputed,
      action: InvoiceAction.REJECT,
      actor: PartyRole.BUYER,
    });

    expect(rejected).toBe(InvoiceStatus.REJECTED);
    expect(isTerminalInvoiceStatus(rejected)).toBe(true);
  });

  it('lets the same dispute end in an acceptance instead', () => {
    expect(
      nextInvoiceStatus({
        from: InvoiceStatus.DISPUTED,
        action: InvoiceAction.ACCEPT,
        actor: PartyRole.BUYER,
      }),
    ).toBe(InvoiceStatus.ACCEPTED);
  });
});

describe('the statuses nothing leaves', () => {
  it('refuses every action from PAID, REJECTED and CANCELLED, for either side', () => {
    for (const status of FINAL) {
      expect(transitionsFrom(status)).toEqual([]);

      for (const action of INVOICE_ACTIONS) {
        for (const actor of PARTY_ROLES) {
          expectDomainError(
            () => assertInvoiceTransition({ from: status, action, actor }),
            DomainErrorCode.STATE_CONFLICT,
          );
        }
      }
    }
  });
});

describe('canIssueCreditNote', () => {
  it('corrects an invoice that left the draft, and nothing else', () => {
    const allowed: readonly InvoiceStatus[] = [
      InvoiceStatus.ISSUED,
      InvoiceStatus.SENT,
      InvoiceStatus.DELIVERED,
      InvoiceStatus.ACCEPTED,
      InvoiceStatus.DISPUTED,
    ];

    for (const status of INVOICE_STATUSES) {
      expect(canIssueCreditNote(status)).toBe(allowed.includes(status));
    }

    expect(canIssueCreditNote(InvoiceStatus.DRAFT)).toBe(false);
    expect(canIssueCreditNote(InvoiceStatus.PAID)).toBe(false);
    expect(canIssueCreditNote(InvoiceStatus.CANCELLED)).toBe(false);
  });
});

describe('isInvoiceAction', () => {
  it('accepts exactly the eight actions the table is built from', () => {
    expect(INVOICE_ACTIONS).toEqual([
      'ISSUE',
      'SEND',
      'MARK_DELIVERED',
      'ACCEPT',
      'DISPUTE',
      'REJECT',
      'MARK_PAID',
      'CANCEL',
    ]);

    for (const action of INVOICE_ACTIONS) {
      expect(isInvoiceAction(action)).toBe(true);
    }
  });

  it('rejects anything else, including an action from the exchange track', () => {
    for (const value of ['issue', 'APPROVE', 'WITHDRAW', '', null, undefined, 7, {}]) {
      expect(isInvoiceAction(value)).toBe(false);
    }
  });
});
