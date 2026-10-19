import { resolve } from 'node:path';

import { config as loadEnv } from 'dotenv';
import type { NextConfig } from 'next';

/**
 * Next.js reads `.env*` from the app directory (`apps/web`), but this monorepo has exactly one
 * environment file, at the repository root, shared with Prisma and (later) the worker. It is loaded
 * here, before the config is used; a package-local `.env.local` still wins when it exists, because
 * dotenv never overwrites a value that is already set.
 *
 * `process.cwd()` is safe to use: every task runs through pnpm/turbo, which sets the working
 * directory to this package.
 */
loadEnv({ path: resolve(process.cwd(), '../../.env'), quiet: true });

const isProduction = process.env.NODE_ENV === 'production';

/**
 * Baseline response headers. The Content-Security-Policy is deliberately *not* here: a policy strict
 * enough for an app with a login form ("nonce per request, no inline script") has to be applied by
 * middleware, which arrives with the app shell in phase 3. These headers are the ones that are
 * correct unconditionally.
 */
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // `camera=(self)` and not `camera=()`: the capture screen opens the rear camera with
  // `getUserMedia` (ADR 0010), and an empty allowlist makes every request fail with
  // `NotAllowedError` before the browser ever asks the person. It is scoped to `self` so the
  // permission is never delegated to an embedded frame. The other three stay closed: nothing in
  // this app asks for them.
  { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=(), payment=()' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  ...(isProduction
    ? [
        {
          key: 'Strict-Transport-Security',
          value: 'max-age=63072000; includeSubDomains; preload',
        },
      ]
    : []),
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  // Workspace packages are consumed as TypeScript source (see ADR 0001), so the compiler has to
  // process them exactly like application code.
  transpilePackages: ['@einv/shared', '@einv/db', '@einv/api-client', '@einv/pdf'],

  // The generated Prisma client must stay external in the server bundle: it resolves engines and
  // runtime files relative to its own location, which bundling breaks.
  serverExternalPackages: ['@prisma/client'],

  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
