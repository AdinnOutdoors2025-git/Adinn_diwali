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

// Quantity is chosen per distribution (default 0 in the form, must be above 0 to save); the server enforces the same range.
export const MAX_DISTRIBUTION_QUANTITY = 10000;
export const MIN_ADDRESS_LENGTH = 5;
export const MAX_ADDRESS_LENGTH = 500;
export const MAX_PROOF_MB = 2;
