/**
 * Page geometry.
 *
 * PDF coordinates are points (1 pt = 1/72 inch) while every layout decision a human makes about an
 * invoice is in millimetres ("18 mm top margin", "60 mm column"). Templates therefore write
 * `mm(18)` and this module is the only place where the conversion exists.
 *
 * `mm()` rejects non-finite input instead of propagating it: a NaN that reaches the renderer
 * produces a silently broken page, and a thrown error at template level is far cheaper to diagnose.
 */

const POINTS_PER_INCH = 72;
const MILLIMETERS_PER_INCH = 25.4;

/** 2.834645669… — exported because the template tests assert against it. */
export const POINTS_PER_MILLIMETER = POINTS_PER_INCH / MILLIMETERS_PER_INCH;

const PRECISION = 100;

/** Rounds to 1/100 pt: far below printer resolution, but enough to absorb IEEE-754 noise. */
function roundToPrecision(value: number): number {
  return Math.round(value * PRECISION) / PRECISION;
}

/** Converts millimetres to PDF points, rounded to 1/100 pt (well below printer resolution). */
export function mm(value: number): number {
  if (!Number.isFinite(value)) {
    throw new RangeError(`mm() needs a finite number, received ${String(value)}`);
  }

  return roundToPrecision(value * POINTS_PER_MILLIMETER);
}

/** ISO 216 A4, in points — the default page for invoices in the EU/Kosovo. */
export const A4_WIDTH = mm(210);
export const A4_HEIGHT = mm(297);

export const PAGE = { width: A4_WIDTH, height: A4_HEIGHT } as const;

/**
 * Print-safe margins: every printer we care about can place content inside these, and the resulting
 * text column is ~178 mm, which fits the invoice line table without horizontal scrolling in print.
 */
export const PAGE_MARGIN = {
  top: mm(18),
  right: mm(16),
  bottom: mm(20),
  left: mm(16),
} as const;

/**
 * Usable content area inside `PAGE_MARGIN`.
 *
 * Re-rounded to the same precision as `mm()`: subtracting two rounded values in floating point gives
 * `504.5799999999999` instead of `504.58`, and layout code that lays out columns inside this width
 * deserves a number whose invariants hold exactly
 * (`PAGE_MARGIN.left + CONTENT_WIDTH + PAGE_MARGIN.right === A4_WIDTH`).
 */
export const CONTENT_WIDTH = roundToPrecision(A4_WIDTH - PAGE_MARGIN.left - PAGE_MARGIN.right);
