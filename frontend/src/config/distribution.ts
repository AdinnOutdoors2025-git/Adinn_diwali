// Mirrors backend/src/config/distribution.ts. The backend remains the authority; these drive the UI only.
export const TYPE_OPTIONS = ['Vendor', 'Client', 'Govt. Official', 'OOH Landlords', 'Bank Official'] as const;
export type ClientType = typeof TYPE_OPTIONS[number];

export const MODE_OPTIONS = ['COURIER', 'IN_PERSON'] as const;
export type DistributionMode = typeof MODE_OPTIONS[number];
export const MODE_LABEL: Record<DistributionMode, string> = { COURIER: 'Courier', IN_PERSON: 'In-person' };

export type DeliveryStatus = 'INITIATE' | 'DISPATCH' | 'SHIPPING' | 'DELIVERED';
export const STATUS_LABEL: Record<DeliveryStatus, string> = { INITIATE: 'Initiate', DISPATCH: 'Dispatch', SHIPPING: 'Shipping', DELIVERED: 'Delivered' };
export const STATUS_FLOW: Record<DistributionMode, readonly DeliveryStatus[]> = {
  COURIER: ['INITIATE', 'DISPATCH', 'SHIPPING', 'DELIVERED'],
  IN_PERSON: ['INITIATE', 'DELIVERED'],
};

export const MAX_ALLOWED_QUANTITY = 1000;
export const MAX_PROOF_MB = 5;
export const clampQuantity = (value: number, max: number) => Math.min(Math.max(1, Math.trunc(value) || 1), Math.max(1, max));
