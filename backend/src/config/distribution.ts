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

// Upper bound accepted when configuring a client's Allowed Quantity.
export const MAX_ALLOWED_QUANTITY = Number(process.env.MAX_ALLOWED_QUANTITY) || 1000;
export const MAX_PROOF_BYTES = (Number(process.env.MAX_PROOF_MB) || 5) * 1024 * 1024;

// Accepts integers or integer strings; anything else (decimals, blanks, NaN) is rejected.
export const parseWholeNumber = (value: unknown): number | null => {
  if (typeof value === 'number') return Number.isInteger(value) ? value : null;
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) return Number(value.trim());
  return null;
};
