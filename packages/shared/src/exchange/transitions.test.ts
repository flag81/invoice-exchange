import { describe, expect, it } from 'vitest';

import {
  DomainErrorCode,
  EXCHANGE_ACTIONS,
  EXCHANGE_STATUSES,
  EXCHANGE_TRANSITIONS,
  ExchangeAction,
  ExchangeStatus,
  PARTY_ROLES,
  PartyRole,
  assertExchangeTransition,
  canApplyExchangeTransition,
  exchangeTransitionsFrom,
  findExchangeTransition,
  isExchangeAction,
  nextExchangeStatus,
} from '../index';
import { expectDomainError } from '../testing/domain-error';

const REASON = 'the amount on the invoice does not match the purchase order';

const FINAL: readonly ExchangeStatus[] = [
  ExchangeStatus.ACCEPTED,
  ExchangeStatus.REJECTED,
  ExchangeStatus.CANCELLED,
];

describe('the exchange transition table (§4.5)', () => {
  it('decides every status × action × actor triple, and refuses the rest', () => {
    for (const from of EXCHANGE_STATUSES) {
      for (const action of EXCHANGE_ACTIONS) {
        for (const actor of PARTY_ROLES) {
          const request = { from, action, actor, reason: REASON };
          const row = findExchangeTransition(from, action);

          if (row === undefined) {
            expectDomainError(
              () => assertExchangeTransition(request),
              DomainErrorCode.STATE_CONFLICT,
            );
            expect(canApplyExchangeTransition(request)).toBe(false);
            continue;
          }

          if (!row.actors.includes(actor)) {
            expectDomainError(
              () => assertExchangeTransition(request),
              DomainErrorCode.PERMISSION_DENIED,
            );
            expect(canApplyExchangeTransition(request)).toBe(false);
            continue;
          }

          expect(assertExchangeTransition(request)).toBe(row);
          expect(nextExchangeStatus(request)).toBe(row.to);
          expect(canApplyExchangeTransition(request)).toBe(true);
        }
      }
    }
  });

  it('gives every action a home, and no two rows the same (from, action)', () => {
    for (const action of EXCHANGE_ACTIONS) {
      expect(EXCHANGE_TRANSITIONS.some((row) => row.action === action)).toBe(true);
    }

    const keys = EXCHANGE_TRANSITIONS.map((row) => `${row.from}/${row.action}`);

    expect(keys).toHaveLength(9);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('lets both sides mark an exchange as viewed, and keeps every other row one-sided', () => {
    const shared = EXCHANGE_TRANSITIONS.filter((row) => row.actors.length > 1);

    expect(shared).toHaveLength(1);
    expect(shared[0]?.action).toBe(ExchangeAction.VIEW);
    expect(shared[0]?.actors).toEqual([PartyRole.BUYER, PartyRole.SUPPLIER]);

    for (const row of EXCHANGE_TRANSITIONS) {
      if (row.action === ExchangeAction.VIEW) {
        continue;
      }

      expect(row.actors).toHaveLength(1);
    }
  });

  it('keeps the supplier-only moves and the buyer-only decisions apart', () => {
    const supplierActions: readonly ExchangeAction[] = [
      ExchangeAction.SEND,
      ExchangeAction.WITHDRAW,
    ];
    const buyerActions: readonly ExchangeAction[] = [
      ExchangeAction.ACCEPT,
      ExchangeAction.DISPUTE,
      ExchangeAction.RESOLVE_ACCEPT,
      ExchangeAction.RESOLVE_REJECT,
    ];

    for (const row of EXCHANGE_TRANSITIONS) {
      if (supplierActions.includes(row.action)) {
        expect(row.actors).toEqual([PartyRole.SUPPLIER]);
      }

      if (buyerActions.includes(row.action)) {
        expect(row.actors).toEqual([PartyRole.BUYER]);
      }
    }
  });

  it('walks pending → sent → viewed → accepted, and stops there', () => {
    let status: ExchangeStatus = ExchangeStatus.PENDING;

    for (const step of [
      { action: ExchangeAction.SEND, actor: PartyRole.SUPPLIER },
      { action: ExchangeAction.VIEW, actor: PartyRole.BUYER },
      { action: ExchangeAction.ACCEPT, actor: PartyRole.BUYER },
    ]) {
      status = nextExchangeStatus({ from: status, action: step.action, actor: step.actor });
    }

    expect(status).toBe(ExchangeStatus.ACCEPTED);
    expect(FINAL).toContain(status);
  });

  it('lets the supplier withdraw before the buyer has decided, from each such status', () => {
    for (const from of [ExchangeStatus.PENDING, ExchangeStatus.SENT, ExchangeStatus.VIEWED]) {
      const withdrawn = nextExchangeStatus({
        from,
        action: ExchangeAction.WITHDRAW,
        actor: PartyRole.SUPPLIER,
      });

      expect(withdrawn).toBe(ExchangeStatus.CANCELLED);
    }
  });

  it('refuses every move once the buyer has decided, and after a withdrawal', () => {
    for (const status of FINAL) {
      expect(exchangeTransitionsFrom(status)).toEqual([]);

      for (const action of EXCHANGE_ACTIONS) {
        for (const actor of PARTY_ROLES) {
          expectDomainError(
            () => assertExchangeTransition({ from: status, action, actor, reason: REASON }),
            DomainErrorCode.STATE_CONFLICT,
          );
        }
      }
    }
  });
});

describe('the reason a dispute carries on the exchange', () => {
  const dispute = {
    from: ExchangeStatus.VIEWED,
    action: ExchangeAction.DISPUTE,
    actor: PartyRole.BUYER,
  };

  it('is mandatory on DISPUTE, and blank counts as missing', () => {
    const applied = assertExchangeTransition({ ...dispute, reason: 'wrong amount' });

    expect(applied.to).toBe(ExchangeStatus.DISPUTED);
    expect(applied.reasonRequired).toBe(true);

    for (const reason of [undefined, '', ' ', '\n\t']) {
      expectDomainError(
        () => assertExchangeTransition({ ...dispute, reason }),
        DomainErrorCode.REASON_REQUIRED,
      );
      expect(canApplyExchangeTransition({ ...dispute, reason })).toBe(false);
    }
  });

  it('is never demanded by a row that does not ask for it', () => {
    for (const row of EXCHANGE_TRANSITIONS) {
      if (row.reasonRequired === true) {
        continue;
      }

      for (const actor of row.actors) {
        expect(assertExchangeTransition({ from: row.from, action: row.action, actor })).toBe(row);
      }
    }
  });

  it('resolves a dispute either way: accepted in favour, rejected against', () => {
    expect(
      nextExchangeStatus({
        from: ExchangeStatus.DISPUTED,
        action: ExchangeAction.RESOLVE_ACCEPT,
        actor: PartyRole.BUYER,
      }),
    ).toBe(ExchangeStatus.ACCEPTED);

    expect(
      nextExchangeStatus({
        from: ExchangeStatus.DISPUTED,
        action: ExchangeAction.RESOLVE_REJECT,
        actor: PartyRole.BUYER,
      }),
    ).toBe(ExchangeStatus.REJECTED);
  });
});

describe('isExchangeAction', () => {
  it('accepts exactly the seven actions the table is built from', () => {
    expect(EXCHANGE_ACTIONS).toEqual([
      'SEND',
      'VIEW',
      'ACCEPT',
      'DISPUTE',
      'RESOLVE_ACCEPT',
      'RESOLVE_REJECT',
      'WITHDRAW',
    ]);

    for (const action of EXCHANGE_ACTIONS) {
      expect(isExchangeAction(action)).toBe(true);
    }
  });

  it('rejects anything else, including an action that belongs to the invoice track', () => {
    for (const value of ['send', 'MARK_PAID', 'ISSUE', '', null, undefined, 5, {}]) {
      expect(isExchangeAction(value)).toBe(false);
    }
  });
});
