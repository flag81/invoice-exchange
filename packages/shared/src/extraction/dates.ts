/**
 * Reading an invoice date off paper, strictly.
 *
 * `new Date('14.03.2026')` is `Invalid Date` while `new Date('03/14/2026')` is silently the *14th of
 * March* — and `new Date('2026-03-14')` is parsed as UTC midnight, which becomes the 13th in a
 * negative-offset timezone. An invoice date is a calendar day, not an instant, so none of that is
 * acceptable: the three formats a Kosovo invoice actually uses are parsed here by hand, and anything
 * else is reported as unreadable instead of guessed at.
 *
 * The output is always `YYYY-MM-DD`. That is what the database stores (`date`, not `timestamptz`) and
 * what the API sends, so no timezone can move an invoice to the day before it was issued.
 */

/** Days per month, February included so a leap year needs no special-case at the call site. */
function daysInMonth(year: number, month: number): number {
  const lengths = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month === 2 && year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)) {
    return 29;
  }

  return lengths[month - 1] ?? 0;
}

function pad(value: number): string {
  return value.toString().padStart(2, '0');
}

function build(day: number, month: number, year: number): string | null {
  if (year < 1900 || year > 2999 || month < 1 || month > 12) {
    return null;
  }

  if (day < 1 || day > daysInMonth(year, month)) {
    return null;
  }

  return `${year.toString().padStart(4, '0')}-${pad(month)}-${pad(day)}`;
}

const ISO_PATTERN = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
const DAY_FIRST_PATTERN = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/;

/**
 * Parses `2026-03-14`, `14.03.2026`, `14/03/2026` or `14-03-2026` into `2026-03-14`.
 *
 * Day-first is the rule for the numeric-with-separator forms because that is what Kosovo (and most of
 * Europe) writes: `03/04/2026` is the third of April, never the fourth of March. A model that returns
 * an ambiguous US-style date therefore produces a *different day*, which is a real risk — mitigated
 * by the review screen, which shows every extracted field to a human before anything is saved.
 */
export function parseInvoiceDate(value: string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const trimmed = value.trim();

  const iso = ISO_PATTERN.exec(trimmed);
  if (iso !== null) {
    return build(Number(iso[3]), Number(iso[2]), Number(iso[1]));
  }

  const dayFirst = DAY_FIRST_PATTERN.exec(trimmed);
  if (dayFirst !== null) {
    return build(Number(dayFirst[1]), Number(dayFirst[2]), Number(dayFirst[3]));
  }

  return null;
}

/** True for the `YYYY-MM-DD` shape this module produces — used to validate API input. */
export function isIsoCalendarDate(value: string): boolean {
  return parseInvoiceDate(value) !== null;
}
