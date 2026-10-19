/**
 * `@einv/shared` — the domain core.
 *
 * Framework-free, dependency-free, I/O-free. Everything that decides *what is true about an invoice*
 * lives here: money arithmetic, tax, totals, both lifecycle state machines, permissions and the string
 * rendering of amounts. Everything that touches the outside world (database, HTTP, mail, files) lives in
 * the apps.
 *
 * The surface, by concern:
 *
 * - `errors` — `DomainError` and its closed set of codes; the only exception type thrown here.
 * - `currency` — the closed ISO 4217 set and the minor-unit exponent that turns integers into money.
 * - `scaled` — exact 4 dp arithmetic for quantities and rates (`parseQuantity`, `parseRate`,
 *   `divRoundHalfUp`) and the single rounding rule the whole domain shares.
 * - `money` — `MinorUnits` (`bigint`), parsing, rendering and exact arithmetic.
 * - `tax`, `totals` — rates, categories and the four formulas of §4.4 in one place.
 * - `invoicing/` — party roles, `InvoiceStatus`, the transition table and the structural invariants.
 * - `exchange/` — `ExchangeStatus`, its transition table and the projection onto the invoice track.
 * - `tenancy/` — roles and the permission matrix (§5.5).
 * - `format/` — minor units to strings for a human, and user input back to the plain form: no `Intl`, no
 *   float, no rounding.
 *
 * Import from the package root (`import { computeTotals } from '@einv/shared'`); the `exports` map also
 * allows deep imports, but the barrel below is the supported surface. Phase 2 (`packages/db`) and phase 3
 * (`apps/web`) are the only consumers, so anything not exported here is private by construction.
 */
export * from './currency';
export * from './errors';
export * from './scaled';
export * from './money';
export * from './tax';
export * from './totals';
export * from './invoicing/parties';
export * from './invoicing/status';
export * from './invoicing/transitions';
export * from './invoicing/invariants';
export * from './invoicing/duplicates';
export * from './exchange/status';
export * from './exchange/transitions';
export * from './exchange/projection';
export * from './tenancy/roles';
export * from './tenancy/permissions';
export * from './format/exact';
export * from './format/money';
export * from './format/decimal';
export * from './documents/upload-policy';
export * from './extraction/types';
export * from './extraction/dates';
export * from './extraction/raw';
export * from './extraction/values';
export * from './extraction/build';
export * from './extraction/normalise';
export * from './extraction/submission';
export * from './version';
