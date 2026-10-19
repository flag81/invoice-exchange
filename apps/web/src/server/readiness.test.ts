import { DatabaseUnavailableError, type Tenant } from '@einv/db';
import { CurrencyCode, Role, TaxCategory } from '@einv/shared';
import { describe, expect, it, vi } from 'vitest';

import type { Actor } from './auth/session';
import { describeReadiness, describeTenant } from './readiness';

/**
 * `redirect()` is Next's control-flow signal, and it throws. Mocking it lets the test assert on the
 * *destination* — which is the whole contract of the sign-in wall — without a Next runtime.
 */
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
}));

const tenant: Tenant = {
  companyId: 'company-1',
  companyName: 'Demo Market Sh.p.k',
  currency: CurrencyCode.EUR,
  countryCode: 'XK',
  taxRates: [{ id: 'vat-18', name: 'TVSH 18%', category: TaxCategory.STANDARD, ratePercent: '18' }],
  defaultTaxRateId: 'vat-18',
};

const actor: Actor = {
  sessionId: 'session-1',
  userId: 'user-1',
  email: 'arta@example.com',
  name: 'Arta',
  imageUrl: null,
  role: Role.OWNER,
  tenant,
  expiresAt: new Date('2026-11-16T10:00:00.000Z'),
};

describe('describeReadiness', () => {
  it('is ready when someone is signed in, and hands the page the actor', async () => {
    const readiness = await describeReadiness('/invoices', () => Promise.resolve(actor));

    expect(readiness.ready).toBe(true);
    expect(readiness.ready && readiness.actor).toBe(actor);
    expect(readiness.ready && describeTenant(readiness.actor.tenant)).toBe(
      'Demo Market Sh.p.k · EUR · 1 normë TVSH-je',
    );
  });

  it('sends a signed-out visitor to /signin, carrying the page they wanted', async () => {
    await expect(
      describeReadiness('/invoices/abc', () => Promise.resolve(null)),
    ).rejects.toThrowError('redirect:/signin?next=%2Finvoices%2Fabc');
  });

  it('omits `next` when the wanted page is the home screen', async () => {
    await expect(describeReadiness('/', () => Promise.resolve(null))).rejects.toThrowError(
      'redirect:/signin',
    );
  });

  it('is not ready, with the setup advice, when there is no database', async () => {
    const readiness = await describeReadiness('/invoices', () =>
      Promise.reject(new DatabaseUnavailableError('run pnpm db:dev')),
    );

    expect(readiness).toEqual({ ready: false, message: 'run pnpm db:dev' });
  });

  it('lets a genuine bug through instead of dressing it up as "not ready"', async () => {
    await expect(
      describeReadiness('/invoices', () => Promise.reject(new TypeError('a bug'))),
    ).rejects.toThrowError(TypeError);
  });
});
