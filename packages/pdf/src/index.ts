/**
 * `@einv/pdf` — turns one immutable invoice version into one deterministic PDF.
 *
 * Contract (fixed now, implemented in phase 4 — see ADR 0005):
 *   * `renderInvoicePdf(document: InvoiceDocumentModel)` takes every value as input: locale,
 *     timezone, currency, formatted strings and the rendered-at timestamp. The renderer reads no
 *     clock and performs no I/O, so the same input always produces byte-identical output — which is
 *     what makes the stored `documentHash` meaningful.
 *   * It returns `Uint8Array`; writing the bytes to storage is the caller's job (see ADR 0004).
 *   * Fonts are bundled (no runtime font download) and the layout is the EU-shaped
 *     header → parties → line table → tax summary → totals → payment details → notes.
 */
export {
  A4_HEIGHT,
  A4_WIDTH,
  CONTENT_WIDTH,
  PAGE,
  PAGE_MARGIN,
  POINTS_PER_MILLIMETER,
  mm,
} from './units';
