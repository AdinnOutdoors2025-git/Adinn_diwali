import { DistributionRow } from '../types';

// Given = Delivered (or legacy, untracked) records; In Progress = saved but not yet Delivered; Not Given = nothing saved.
export type QuantityBucket = 'GIVEN' | 'IN_PROGRESS' | 'NOT_GIVEN';

export const bucketOf = (row: DistributionRow): QuantityBucket => {
  const dist = row.currentYearDistribution;
  if (row.isEligible || !dist) return 'NOT_GIVEN';
  return dist.quantityState ?? (!dist.status || dist.status === 'DELIVERED' ? 'GIVEN' : 'IN_PROGRESS');
};
export const quantityOf = (row: DistributionRow): number => row.currentYearDistribution?.quantity ?? 0; // records without a stored quantity (legacy, or nothing saved yet) count as 0, never an assumed value

export interface Tally { clients: number; quantity: number }
export const tally = (rows: DistributionRow[]): Tally => ({ clients: rows.length, quantity: rows.reduce((sum, row) => sum + quantityOf(row), 0) });

export function quantityTotals(rows: DistributionRow[]) {
  const given = tally(rows.filter(row => bucketOf(row) === 'GIVEN'));
  const inProgress = tally(rows.filter(row => bucketOf(row) === 'IN_PROGRESS'));
  const pending = tally(rows.filter(row => bucketOf(row) === 'NOT_GIVEN'));
  const total = given.quantity + inProgress.quantity + pending.quantity;
  return { given, inProgress, pending, total, completion: total ? Math.round(given.quantity / total * 10000) / 10000 : 0 };
}
