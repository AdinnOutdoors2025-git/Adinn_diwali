export const CLIENT_TYPES = ['Vendor', 'Client', 'Govt. Official', 'OOH Landlords', 'Bank Official'] as const;
export type ClientType = typeof CLIENT_TYPES[number];
export const isClientType = (value: unknown): value is ClientType => CLIENT_TYPES.includes(value as ClientType);

export const DISTRIBUTION_MODES = ['COURIER', 'IN_PERSON'] as const;
export type DistributionMode = typeof DISTRIBUTION_MODES[number];
export const isDistributionMode = (value: unknown): value is DistributionMode => DISTRIBUTION_MODES.includes(value as DistributionMode);

export const DELIVERY_STATUSES = ['INITIATE', 'DISPATCH', 'SHIPPING', 'DELIVERED'] as const;
export type DeliveryStatus = typeof DELIVERY_STATUSES[number];

// Ordered stages per mode. A record may only move to the stage immediately after its current one.
export const STATUS_FLOW: Record<DistributionMode, readonly DeliveryStatus[]> = {
  COURIER: ['INITIATE', 'DISPATCH', 'SHIPPING', 'DELIVERED'],
  IN_PERSON: ['INITIATE', 'DELIVERED'],
};

export const nextStatus = (mode: DistributionMode, current: DeliveryStatus): DeliveryStatus | null => {
  const flow = STATUS_FLOW[mode];
  const index = flow.indexOf(current);
  return index >= 0 && index < flow.length - 1 ? flow[index + 1] : null;
};

// Every distribution is exactly this many sweets. It is set here, never taken from the request.
export const DISTRIBUTION_QUANTITY = 5;
// Fixed cap (not env-configurable) so the frontend and backend always agree.
export const MIN_ADDRESS_LENGTH = 5;
export const MAX_ADDRESS_LENGTH = 500;
export const MAX_PROOF_MB = 2;
export const MAX_PROOF_BYTES = MAX_PROOF_MB * 1024 * 1024;


// Quantity accounting: a saved distribution is IN_PROGRESS until its status is DELIVERED, then it is GIVEN.
// Legacy records with no status workflow predate tracking and keep the original business logic: they count as GIVEN.
export type QuantityState = 'GIVEN' | 'IN_PROGRESS';
export const quantityState = (status?: DeliveryStatus | null): QuantityState =>
  !status || status === 'DELIVERED' ? 'GIVEN' : 'IN_PROGRESS';
