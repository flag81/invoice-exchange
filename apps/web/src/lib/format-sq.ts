/**
 * Dates as Kosovo writes them: `14.03.2026`.
 *
 * The database and the API keep ISO calendar days (`2026-03-14`) — that is the contract, and a
 * formatter is a display decision that must not leak into it. Money needs no formatter (`@einv/shared`
 * already groups digits as `1.234,56`); dates are the one value the browser would otherwise print the
 * American way, so this is the one function.
 *
 * Anything that is not a padded ISO date is returned unchanged rather than guessed at: a value the
 * extractor could not read is better shown as it arrived than silently rewritten.
 */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function formatDateSq(isoDate: string): string {
  const match = ISO_DATE.exec(isoDate);

  if (match === null) {
    return isoDate;
  }

  const [, year = '', month = '', day = ''] = match;
  const monthNumber = Number(month);
  const dayNumber = Number(day);

  if (monthNumber < 1 || monthNumber > 12 || dayNumber < 1 || dayNumber > 31) {
    return isoDate;
  }

  return `${day}.${month}.${year}`;
}
