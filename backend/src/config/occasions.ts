// Occasions (festivals) the sweet distribution runs for. The list lives in MongoDB so anyone can add one;
// these defaults are seeded once and are never removed.
export const DEFAULT_OCCASIONS = ['Diwali', 'Pongal', 'Christmas', 'New Year'] as const;
// Records created before occasions existed have no `occasion` field; they all belong to Diwali.
export const LEGACY_OCCASION = 'Diwali';

export const MIN_OCCASION_LENGTH = 2;
export const MAX_OCCASION_LENGTH = 50;
const OCCASION_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N} &'.\-]*$/u;

export const cleanOccasionName = (value: unknown): string => (typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '');
export const normalizeOccasionName = (value: string): string => value.toLowerCase();
export const validateOccasionName = (name: string): string | null => {
  if (name.length < MIN_OCCASION_LENGTH || name.length > MAX_OCCASION_LENGTH) return `Occasion name must be ${MIN_OCCASION_LENGTH} to ${MAX_OCCASION_LENGTH} characters.`;
  if (!OCCASION_PATTERN.test(name)) return "Occasion name can only contain letters, numbers, spaces and & ' . -";
  return null;
};

/** Mongo match for an occasion. Diwali also matches records that predate occasions (no field). */
export const occasionMatch = (name: string): string | { $in: (string | null)[] } => (name === LEGACY_OCCASION ? { $in: [name, null] } : name);
