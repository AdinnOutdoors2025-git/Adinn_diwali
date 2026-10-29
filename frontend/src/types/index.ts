import type { ClientType, DistributionMode, DeliveryStatus } from '../config/distribution';

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

export { TYPE_OPTIONS } from '../config/distribution';
export type { ClientType, DistributionMode, DeliveryStatus } from '../config/distribution';

export interface ClientRecord {
  _id: string;
  associationId: string;
  clientId: string;
  name: string;
  mobile: string;
  email?: string;
  type: ClientType | null;
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
  type: ClientType | null;
  bd: BD | null;
  associations: { _id: string; type: ClientType | null; legacyVertical: string | null; bd: BD | null }[];
  createdAt: string;
  lastGiven: number | null;
  lastGivenDate: string | null;
  isEligible: boolean;
  selectedYear: number;
  currentYearDistribution: {
    _id: string;
    distributionYear: number;
    type: ClientType | null;
    legacyVertical: string | null;
    quantity: number | null;
    mode: DistributionMode | null;
    status: DeliveryStatus | null;
    quantityState?: 'GIVEN' | 'IN_PROGRESS';
    statusHistory: { status: DeliveryStatus; at: string }[];
    hasProof: boolean;
    deliveredAt: string | null;
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
