// Single source of truth for the Diwali-year policy used by every page.
//
// - FIRST_DIWALI_YEAR: earliest year ever offered in the selector.
// - Operating year: the year selected by default. It rolls over on ROLLOVER (MM-DD, default 01-01).
//   Diwali itself falls in Oct/Nov and moves every year, so the real activation date is a business
//   decision: set VITE_DIWALI_ROLLOVER (e.g. "08-01") or pin VITE_DIWALI_OPERATING_YEAR to change it.
// - Selector years run from FIRST_DIWALI_YEAR to operating year + YEARS_AHEAD, so future years appear automatically.
export const FIRST_DIWALI_YEAR = 2026;
export const YEARS_AHEAD = 3;

export interface YearPolicyInput { now?: Date; firstYear?: number; yearsAhead?: number; rollover?: string; operatingYear?: number }

const parseRollover = (value: string | undefined): [number, number] => {
  const match = /^(\d{2})-(\d{2})$/.exec(value || '');
  const month = match ? Number(match[1]) : 1, day = match ? Number(match[2]) : 1;
  return month >= 1 && month <= 12 && day >= 1 && day <= 31 ? [month, day] : [1, 1];
};

export const getYearPolicy = ({ now = new Date(), firstYear = FIRST_DIWALI_YEAR, yearsAhead = YEARS_AHEAD, rollover, operatingYear }: YearPolicyInput = {}) => {
  let operating = operatingYear;
  if (!operating) {
    const [month, day] = parseRollover(rollover);
    const rolled = now.getMonth() + 1 > month || (now.getMonth() + 1 === month && now.getDate() >= day);
    operating = rolled ? now.getFullYear() : now.getFullYear() - 1;
  }
  operating = Math.max(operating, firstYear);
  const years = Array.from({ length: operating - firstYear + yearsAhead + 1 }, (_, index) => firstYear + index);
  return { operatingYear: operating, years };
};

const env = (import.meta as any).env || {};
const configured = Number(env.VITE_DIWALI_OPERATING_YEAR);
export const { operatingYear: DEFAULT_YEAR, years: YEAR_OPTIONS } = getYearPolicy({
  rollover: env.VITE_DIWALI_ROLLOVER, operatingYear: Number.isInteger(configured) && configured > 0 ? configured : undefined,
});
