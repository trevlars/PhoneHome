/**
 * US federal holidays (observed) for School schedule skip.
 * Fixed dates observe Fri-before / Mon-after when they fall on a weekend.
 * Floating Mondays/Thursdays use Nth-weekday rules (no observation shift).
 *
 * Covered: New Year's Day, MLK Day, Presidents' Day, Memorial Day, Juneteenth,
 * Independence Day, Labor Day, Columbus Day / Indigenous Peoples' Day,
 * Veterans Day, Thanksgiving, Christmas Day.
 */

function nthWeekdayOfMonth(year: number, month0: number, weekday: number, n: number): string {
  // weekday: 0=Sun … 6=Sat; n: 1st–4th (or 5th if it exists)
  let count = 0;
  for (let d = 1; d <= 31; d++) {
    const dt = new Date(Date.UTC(year, month0, d));
    if (dt.getUTCMonth() !== month0) break;
    if (dt.getUTCDay() === weekday) {
      count++;
      if (count === n) return dayKey(year, month0 + 1, d);
    }
  }
  throw new Error(`nthWeekdayOfMonth failed ${year}-${month0 + 1} wd=${weekday} n=${n}`);
}

function lastWeekdayOfMonth(year: number, month0: number, weekday: number): string {
  for (let d = 31; d >= 1; d--) {
    const dt = new Date(Date.UTC(year, month0, d));
    if (dt.getUTCMonth() !== month0) continue;
    if (dt.getUTCDay() === weekday) return dayKey(year, month0 + 1, d);
  }
  throw new Error(`lastWeekdayOfMonth failed ${year}-${month0 + 1}`);
}

function dayKey(year: number, month1: number, day: number): string {
  return `${year}-${String(month1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Observe Sat → Fri, Sun → Mon (US federal). */
function observedFixed(year: number, month1: number, day: number): string {
  const dt = new Date(Date.UTC(year, month1 - 1, day));
  const dow = dt.getUTCDay();
  if (dow === 6) {
    // Saturday → Friday
    const prev = new Date(Date.UTC(year, month1 - 1, day - 1));
    return dayKey(prev.getUTCFullYear(), prev.getUTCMonth() + 1, prev.getUTCDate());
  }
  if (dow === 0) {
    // Sunday → Monday
    const next = new Date(Date.UTC(year, month1 - 1, day + 1));
    return dayKey(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate());
  }
  return dayKey(year, month1, day);
}

/** YYYY-MM-DD keys for US federal holidays in `year` (including observed shifts). */
export function usFederalHolidayKeys(year: number): Set<string> {
  const keys = new Set<string>();
  keys.add(observedFixed(year, 1, 1)); // New Year's Day
  keys.add(nthWeekdayOfMonth(year, 0, 1, 3)); // MLK — 3rd Monday Jan
  keys.add(nthWeekdayOfMonth(year, 1, 1, 3)); // Presidents' — 3rd Monday Feb
  keys.add(lastWeekdayOfMonth(year, 4, 1)); // Memorial — last Monday May
  keys.add(observedFixed(year, 6, 19)); // Juneteenth
  keys.add(observedFixed(year, 7, 4)); // Independence Day
  keys.add(nthWeekdayOfMonth(year, 8, 1, 1)); // Labor — 1st Monday Sep
  keys.add(nthWeekdayOfMonth(year, 9, 1, 2)); // Columbus / Indigenous Peoples — 2nd Monday Oct
  keys.add(observedFixed(year, 11, 11)); // Veterans Day
  keys.add(nthWeekdayOfMonth(year, 10, 4, 4)); // Thanksgiving — 4th Thursday Nov
  keys.add(observedFixed(year, 12, 25)); // Christmas
  return keys;
}

export function isUsFederalHoliday(dayKeyYmd: string): boolean {
  const y = Number(String(dayKeyYmd).slice(0, 4));
  if (!Number.isFinite(y)) return false;
  // Include adjacent years so Dec 31 / Jan 1 observation edge cases resolve.
  return (
    usFederalHolidayKeys(y).has(dayKeyYmd) ||
    usFederalHolidayKeys(y - 1).has(dayKeyYmd) ||
    usFederalHolidayKeys(y + 1).has(dayKeyYmd)
  );
}
