// Run: npx tsx tests/quantity-state.test.ts   (pure logic; touches no database)
// Covers In Progress vs Given quantity accounting, legacy records, and the Excel Summary/analytics sheets.
import assert from 'node:assert/strict';
import { quantityState } from '../src/config/distribution.js';
import { quantityTotals } from '../../frontend/src/utils/distributionStats.js';
import { buildEntryWorkbook } from '../../frontend/src/utils/entryWorkbook.js';
import * as XLSX from 'xlsx';

let passed = 0;
const ok = (label: string) => { passed++; console.log(`PASS: ${label}`); };

assert.equal(quantityState('INITIATE'), 'IN_PROGRESS'); assert.equal(quantityState('DISPATCH'), 'IN_PROGRESS');
assert.equal(quantityState('SHIPPING'), 'IN_PROGRESS'); assert.equal(quantityState('DELIVERED'), 'GIVEN');
assert.equal(quantityState(undefined), 'GIVEN'); ok('backend quantityState: only DELIVERED (and legacy) is Given');

const row = (id: string, dist: null | { mode?: any; status?: any; quantity?: number; type?: string }, type = 'Client'): any => ({
  _id: id, clientId: id, clientName: id, clientMobile: '1', clientEmail: '', createdAt: new Date().toISOString(), isEligible: !dist, lastGiven: null, lastGivenDate: null,
  associations: [{ _id: 'a' + id, type, bd: { _id: 'bd1', name: 'B', email: 'b@x.com' } }],
  currentYearDistribution: dist && { _id: 'd' + id, type, quantity: dist.quantity ?? 5, mode: dist.mode ?? null, status: dist.status ?? null, bdId: 'bd1', hasProof: false,
    deliveredAt: null, distributedAt: new Date().toISOString(), statusHistory: [] },
});
const rows = [
  row('1', { mode: 'COURIER', status: 'INITIATE' }), row('2', { mode: 'COURIER', status: 'SHIPPING' }), row('3', { mode: 'COURIER', status: 'DELIVERED' }),
  row('4', { mode: 'IN_PERSON', status: 'INITIATE' }), row('5', { mode: 'IN_PERSON', status: 'DELIVERED', quantity: 5 }),
  row('6', { quantity: 5 }), row('7', null), row('8', null),
];
const t = quantityTotals(rows);
assert.equal(t.given.quantity, 15); assert.equal(t.inProgress.quantity, 15); assert.equal(t.pending.quantity, 10); assert.equal(t.total, 40);
assert.equal(t.total - t.given.quantity - t.inProgress.quantity, t.pending.quantity);
assert.equal(t.completion, 0.375); ok('totals: Given=Delivered+legacy, In Progress=non-delivered, Pending=Total-Given-InProgress, Completion=Given/Total');

const moved = quantityTotals(rows.map(r => r._id === '1' ? row('1', { mode: 'COURIER', status: 'DELIVERED' }) : r));
assert.equal(moved.given.quantity, 20); assert.equal(moved.inProgress.quantity, 10); assert.equal(moved.total, 40); ok('status -> Delivered moves quantity without double counting');

async function main() {
const blob = buildEntryWorkbook(rows, [{ _id: 'bd1', name: 'B', email: 'b@x.com' } as any], { year: 2026, type: 'ALL', bd: 'ALL', status: 'ALL', mode: 'ALL', deliveryStatus: 'ALL', search: '' });
const book = XLSX.read(Buffer.from(await blob.arrayBuffer()), { type: 'buffer' });
assert.deepEqual(book.SheetNames, ['Summary', 'Distribution Details', 'Type Analytics', 'Requestee Analytics']);
const sheet = (name: string) => XLSX.utils.sheet_to_json<any[]>(book.Sheets[name], { header: 1, defval: '' });
const summary = sheet('Summary').map(r => r.join('|')).join('\n');
for (const needle of ['In Progress Quantity', 'COURIER', 'IN-PERSON', 'Delivered / Given', 'NOT GIVEN', 'LEGACY (NO MODE)', 'Not Given (no distribution saved)']) assert.ok(summary.toUpperCase().includes(needle.toUpperCase()), needle);
const find = (label: string) => sheet('Summary').find(r => String(r[0]).trim() === label)!;
assert.deepEqual(find('Given').slice(1, 3), [3, 15]); assert.deepEqual(find('In Progress').slice(1, 3), [3, 15]); assert.deepEqual(find('Not Given').slice(1, 3), [2, 10]);
const details = sheet('Distribution Details'); const statusCol = details[0].indexOf('Distribution Status');
assert.deepEqual(details.slice(1).map(r => r[statusCol]), ['In Progress', 'In Progress', 'Given', 'In Progress', 'Given', 'Given', 'Not Given', 'Not Given']);
const types = sheet('Type Analytics'); assert.deepEqual(types[0].slice(0, 5), ['Type', 'Eligible clients/vendors', 'Given', 'In Progress', 'Not Given']);
assert.deepEqual(types.find(r => r[0] === 'Client')!.slice(2, 5), [3, 3, 2]); ok('Excel: Summary KPIs, per-mode status table, details and analytics are consistent');

console.log(`\n${passed} passed`);
}
main().catch(e => { console.error(e); process.exit(1); });
