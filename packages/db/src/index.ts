/**
 * `@einv/db` — the only place that talks to PostgreSQL.
 *
 * The package owns five things and nothing else:
 *
 *   * the **client** (`client.ts`): one Prisma instance, one place that reads `DATABASE_URL`, and the
 *     translation of "the database is not there" into `DatabaseUnavailableError`, which the HTTP layer
 *     turns into a 503 with advice instead of a stack trace;
 *   * the **tenant** (`tenancy.ts`): loads the company a request acts for — its currency and VAT rates —
 *     scoped by the id the session resolved to;
 *   * **identity** (`auth/`): sign-in (user, OAuth account, membership and first company in one
 *     transaction), sessions, and single-use OAuth state (ADR 0009);
 *   * the **repositories** (`documents.ts`, `extractions.ts`, `invoices/`): every write and read, all
 *     of them tenant-scoped and all of them returning *views* with money as minor-unit strings;
 *   * the pure **mappers** (`invoices/mappers.ts`, `invoices/view.ts`): row ⇄ domain, testable with no
 *     database at all.
 *
 * Nothing here may import Next.js, React or the HTTP layer (enforced in eslint.config.mjs).
 */
export {
  DatabaseUnavailableError,
  databaseUrl,
  disconnectDatabase,
  getPrismaClient,
  isConnectionFailure,
  isDatabaseConfigured,
  withDatabase,
} from './client';
export { describeDatabaseUrl, redactDatabaseUrl, type DatabaseTarget } from './dsn';
export {
  DocumentKind,
  findDocumentById,
  findDocumentByKey,
  recordDocument,
  type DocumentRow,
  type RecordDocumentInput,
} from './documents';
export {
  ExtractionStatus,
  recordExtraction,
  attachExtractionToInvoice,
  type ExtractionRow,
  type RecordExtractionInput,
} from './extractions';
export {
  CaptureSource,
  formatCalendarDate,
  parseCalendarDate,
  parseTaxSummary,
  serialiseTaxSummary,
  toInvoiceCreateData,
  type CaptureSource as CaptureSourceValue,
  type InvoiceCreateData,
  type InvoiceLineCreateData,
} from './invoices/mappers';
export {
  findDuplicateInvoice,
  getInvoiceById,
  INVOICE_SEARCH_MAX_LENGTH,
  invoiceSearchTerms,
  listInvoices,
  normaliseInvoiceSearch,
  saveCapturedInvoice,
  type FindDuplicateInvoiceInput,
  type ListInvoicesOptions,
  type SaveCapturedInvoiceInput,
} from './invoices/repository';
export {
  quantityText,
  rowTotalsAreConsistent,
  taxSummaryOf,
  toInvoiceSummaryView,
  toInvoiceTotals,
  toInvoiceView,
  type InvoiceLineRow,
  type InvoiceRow,
  type InvoiceSummaryView,
  type InvoiceView,
  type InvoiceViewLine,
} from './invoices/view';
export {
  listMembershipsForUser,
  signInWithOAuth,
  type OAuthProfile,
  type SignedInIdentity,
} from './auth/accounts';
export {
  createOAuthState,
  consumeOAuthState,
  type ConsumedOAuthState,
  type CreateOAuthStateInput,
} from './auth/oauth-state';
export {
  KOSOVO_VAT_RATES,
  PROVISIONED_COUNTRY_CODE,
  PROVISIONED_CURRENCY,
  provisionedCompanyName,
  type ProvisionedTaxRate,
} from './auth/provisioning';
export {
  createSession,
  findActiveSession,
  revokeSessionByTokenHash,
  touchSession,
  type ActiveSession,
  type CreateSessionInput,
} from './auth/sessions';
export { loadTenant, toDomainTaxRate, type TaxRateRow, type Tenant } from './tenancy';
