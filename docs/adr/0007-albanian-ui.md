# ADR 0007 — An Albanian UI without an i18n framework

- **Status**: accepted (capture MVP), implemented in `apps/web` and `packages/shared`
- **Date**: 2026-10-17

## Context

The product is sold in Kosovo, the invoices are Albanian, and the people holding the phone are the
supplier's own staff. The capture screen was written in English because it was written first; that is
the only reason it was English, and it is not a good one.

Three facts shaped the decision:

- there is **one** market and **one** locale. Nothing in the roadmap adds a second one, and the seed
  data is Kosovo's VAT table;
- most of the text a user sees is **not** in the app at all — the review screen's warnings and errors
  come from `@einv/shared`'s normaliser, and they embed computed values (`"1.234,56"`, `18 %`,
  `3 rreshta`);
- money is already rendered the way this market writes it (`1.234,56`): grouping and decimal separator
  are fixed in `@einv/shared` and are not a UI concern. Only **dates** were still the browser's
  decision (`03/14/2026`), which is wrong for every reader here.

## Decision

1. **One locale, one typed copy module.** All UI strings live in `apps/web/src/lib/copy/sq.ts` as a
   `const` object. There is no `t('key')`, no message catalogues, no runtime locale negotiation and no
   plural-rule engine: a mistyped key is a **compile error**, and Albanian's count rule is one
   function (`count(1, 'rresht', 'rreshta')`).
2. **The brand shown to people is `e-Fatura`.** The machine-facing identity does not move: `APP_NAME`
   (`e-Invoice Exchange`) stays the document title, `applicationName` and `/api/health` metadata, so
   logs, support scripts and the API keep one stable name. `<html lang="sq">`.
3. **Domain problem messages are translated at the source.** A message such as
   `"12,345" nuk është çmim në EUR; shkruaje` is built in `packages/shared/src/extraction/*` next to the
   value it quotes, and the tests that already assert the quoted value keep asserting it. The
   `DraftProblem.code` (`INVALID_UNIT_PRICE`, `TAX_RATE_ASSUMED`, …) is the **contract** and is never
   translated; prose is for people, codes are for programs. The same rule applies to the storage,
   upload and database messages that reach a screen (`upload-policy.ts`, `client.ts`, `tenancy.ts`).
4. **Dates are formatted at the edge.** `formatDateSq` turns the stored ISO calendar day
   (`2026-03-14`) into `14.03.2026` for display only. The database, the API and the preview keep ISO:
   a formatter must never be able to change what is stored. Money keeps using `formatMoney`; currency
   stays the ISO code (`EUR`) after the amount, because that is what the invoice says.
5. **Not translated, deliberately:** source comments and documentation, log lines, API `code`s and
   route paths, the future PDF templates (they are a typographic decision of their own), and the
   `/api/health` metadata. There is no locale switcher: a switcher with one locale is a bug factory.

## Consequences

- A new screen cannot ship with an English label by accident: the copy module is the only place with
  words in it, and a missing key fails `pnpm typecheck` rather than rendering blank.
- Albanian labels run 20–30 % longer than their English equivalents. Layout is verified at 360 px on
  the capture and review screens, where the save button and the totals live.
- `apps/web/src/lib/copy/**` is excluded from the coverage gate (`vitest.config.ts`): it is pure data,
  and counting string literals would reward tests that walk a table rather than tests that check
  behaviour. Its two functions that _do_ branch (`statusLabel`, `captureSourceLabel`) are covered.
- Four tests asserted English prose (`normalise.test.ts`, `submission.test.ts`, `gemini.test.ts`,
  `repository.test.ts`, and the tenant summary in `readiness.test.ts`). They now assert the Albanian
  fragment. Tests that assert an embedded value (`31,00 EUR`, `XBT`, `rate-missing`) were untouched —
  which is the sign that the messages were built in the right place.
- **Migration path if a second language ever arrives:** `DraftProblem` already carries `code` plus a
  rendered `message`, and the UI renders `message`. A second locale therefore means (a) `code` +
  `params` instead of prose inside `packages/shared`, (b) a catalogue keyed by code in the app, and
  (c) `sq.ts` becoming `sq.ts` + `en.ts` behind one selector. Nothing else in the domain changes,
  because no code branches on prose today.

## Alternatives rejected

- **`next-intl` / `react-i18next`.** A router, a provider, a message format and a build step to serve
  one locale; and `t('capture.title')` is a string key, which is exactly the kind of typo TypeScript
  stops catching.
- **Translating in the components.** The problem messages are produced inside `@einv/shared` with the
  values that make them useful; re-deriving them in JSX would mean either duplicating the rules or
  losing the numbers.
- **A locale switcher now.** Two half-maintained languages are worse than one complete one, and the
  market is single-language. D7's "Albanian next" is now "Albanian only, and here is how to add the
  next one".
