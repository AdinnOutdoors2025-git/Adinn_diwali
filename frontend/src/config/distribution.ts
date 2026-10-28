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

// Every distribution is exactly this many; the server sets it, so it cannot be edited from the browser.
export const DISTRIBUTION_QUANTITY = 5;
export const MAX_PROOF_MB = 5;
