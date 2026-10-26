// First Diwali year this application tracks. Distributions cannot be recorded for earlier years.
// Reading historical data is never restricted by this value.
export const FIRST_DIWALI_YEAR = Number(process.env.DIWALI_FIRST_YEAR) || 2026;
export const LAST_SUPPORTED_YEAR = 2100;
export const isRecordableYear = (year: number): boolean =>
  Number.isInteger(year) && year >= FIRST_DIWALI_YEAR && year <= LAST_SUPPORTED_YEAR;
