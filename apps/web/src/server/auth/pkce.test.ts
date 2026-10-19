import { describe, expect, it } from 'vitest';

import { codeChallengeS256, createCodeVerifier } from './pkce';

describe('createCodeVerifier', () => {
  it("is 43 base64url characters, inside RFC 7636's 43..128 range", () => {
    const verifier = createCodeVerifier();

    expect(verifier).toHaveLength(43);
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('differs per attempt, because a reused verifier makes an intercepted code reusable', () => {
    expect(createCodeVerifier()).not.toBe(createCodeVerifier());
  });
});

describe('codeChallengeS256', () => {
  it("reproduces RFC 7636 appendix B's example, which is the definition of the method", () => {
    // The verifier and its expected challenge, copied from the RFC. If this test ever fails, Google
    // would reject every sign-in, so it is the cheapest possible canary.
    expect(codeChallengeS256('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });

  it('is 43 url-safe characters and never the verifier itself', () => {
    const verifier = createCodeVerifier();
    const challenge = codeChallengeS256(verifier);

    expect(challenge).toHaveLength(43);
    expect(challenge).not.toBe(verifier);
  });
});
