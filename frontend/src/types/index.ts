export type UserRole = 'STAFF' | 'CMD';

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
}

export interface BD {
  _id: string;
  name: string;
  email: string;
  createdAt?: string;
  updatedAt?: string;
}

export const VERTICAL_OPTIONS = [
  'Roadshow',
  'Outdoor',
  'Signage',
  'Media & Arts',
  'POPs & Offsets',
  'Fixtures',
  'Events & Activation',
  'Digital Marketing',
  'Software Development',
  'Wall Painting',
] as const;

export type VerticalType = typeof VERTICAL_OPTIONS[number];

export interface ClientRecord {
  _id: string;
  associationId: string;
  clientId: string;
  name: string;
  mobile: string;
  email?: string;
  vertical: VerticalType;
  bd: BD | string;
  createdAt?: string;
  updatedAt?: string;
}

export interface DistributionRow {
  _id: string;
  associationId: string | null;
  clientId: string;
  clientName: string;
  clientMobile: string;
  clientEmail: string;
  vertical: VerticalType | null;
  bd: BD | null;
  associations: { _id: string; vertical: VerticalType; bd: BD | null }[];
  createdAt: string;
  lastGiven: number | null;
  lastGivenDate: string | null;
  isEligible: boolean;
  selectedYear: number;
  currentYearDistribution: {
    _id: string;
    distributionYear: number;
    vertical: string;
    bdId: string | null;
    bdName: string;
    bdEmail: string;
    distributedAt: string;
    notes?: string;
  } | null;
}

export interface ExcelRowPreview {
  index: number;
  name: string;
  mobile: string;
  email: string;
  isValid: boolean;
  isDuplicate: boolean;
  statusText: string;
}

export interface ImportSummary {
  totalReceived: number;
  successful: number;
  duplicates: number;
  invalid: number;
  skipped: number;
}
