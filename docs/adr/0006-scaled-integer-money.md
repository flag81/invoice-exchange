# ADR 0006 — Money and quantities as scaled integers, not `decimal.js`

- **Status**: accepted (phase 1), implemented in `packages/shared` and used by the capture MVP
- **Date**: 2026-10-16

## Context

The stack table in `docs/architecture.md` named `decimal.js` for money arithmetic. What the domain
actually needs is narrower than a decimal library:

- every amount on an invoice is a whole number of **minor units** (`1234n` = `12.34 EUR`), and the
  currency decides the exponent — EUR 2, JPY 0, KWD 3;
- the only two things that are not integers are a **quantity** (`2.5` hours) and a **tax rate**
  (`8.5 %`), and both are fixed at 4 decimal places (§4.3);
- exactly one rounding decision exists in the domain (§4.4): half away from zero, per line, before
  summing.

A decimal library is the right tool when arbitrary precision and configurable rounding _are_ the
requirement. Here they are the opposite: the precision is fixed, the rounding rule is fixed, and any
second way to represent an amount is a place where the two representations can disagree.

This matters more, not less, now that an AI reads invoices. `@einv/shared`'s normaliser receives
`"1.234,56"` from a model, and the safety property we want is that a misread amount becomes an
**error a human sees**, never a silently different number. That property is easy to prove over
`bigint` and hard to prove over a float-shaped API.

## Decision

1. Money is `type MinorUnits = bigint`. Parsing is `parseAmount(string, currency)`, rendering is
   `toDecimalString(minor, currency)`; both take the currency, and the arithmetic
   (`add`, `subtract`, `sum`, `multiplyByQuantity`, `applyRate`) does not. Rounding lives in one
   function, `divRoundHalfUp`, and everything that can round calls it.
2. Quantities and rates are **4 dp scaled integers** (`25000n` = `2.5`, `85000n` = `8.5`), so they
   share one parser (`parseScaledDecimal`) and one grammar with money.
3. `Decimal` appears nowhere in the domain, the database or the API. The database stores the same
   integers (`BigInt` columns, and quantities as scaled `BigInt`), so no conversion layer exists that
   could round something on the way in or out.
4. `@einv/shared` keeps its zero-dependency guarantee. This was ADR 0001's first decision, and it is
   what lets the domain core run unchanged in the browser (the review screen's live preview calls
   `computeTotals` itself) and in the future React Native client.
5. Rounding is done **per line, before summing**, so `subtotalMinor` is the sum of the amounts
   actually printed on the lines rather than a total that quietly disagrees with its own rows.

## Consequences

- Exactness is structural: there is no path by which a binary float enters a total, because `number`
  is not an accepted amount type anywhere in the domain.
- Property tests become the natural tool (`totals.test.ts` proves the identities of §4.4 over
  arbitrary inputs), and they run in milliseconds.
- JSON needs a rule, because JSON has no `bigint`: the API sends money as **decimal strings of minor
  units** (`"4365"`), quantities as machine decimals (`"2.5"`), and both the browser and the future
  mobile client parse them with the same functions that produced them. `JSON.stringify` throws on a
  `bigint`, which turns "someone forgot the rule" into a loud failure instead of a silent one.
- Percentages are compared by scaled value when matching a rate the model read against the tenant's
  `TaxRate` rows, so `"18"`, `"18.0"` and `"18 %"` are the same rate.
- Trade-off: a rate or quantity needing more than 4 dp would require a schema change. Nothing in
  Kosovo's fiscal rules needs one, and the scale is a named constant (`QUANTITY_SCALE`,
  `RATE_SCALE`) rather than a literal, so the change is one constant plus a migration.

## Alternatives rejected

- **`decimal.js`** — relocated the representation problem rather than solving it: we would still store
  integers, and we would add a dependency to the package whose whole value is having none (ADR 0001).
- **Floats (`number`) for amounts** — `0.1 + 0.2 !== 0.3` is not a theoretical concern on a tax
  document; it is a rounding bug with a legal consequence.
- **`Decimal` columns in Postgres via Prisma** — a second numeric type at the database edge means a
  conversion in every repository method, and every conversion is a chance to drop a digit.
- **Storing amounts as major-unit decimal strings** — moves parsing into every read path, including
  the ones written in SQL later (reports, exports), and makes "is this cents or euros?" a question
  every future reader has to answer.
