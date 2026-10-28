// Run from the frontend folder: npm test   (bundles with esbuild, then runs under Node)
// Builds the Entry workbook in memory and re-reads it, so no browser, server or database is needed.
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { buildEntryWorkbook, EntryExportFilters } from '../src/utils/entryWorkbook';
import type { BD, DistributionRow } from '../src/types';

let passed = 0;
const ok = (label: string) => { passed++; console.log(`PASS: ${label}`); };

const bd: BD = { _id: 'bd1', name: 'Asha Requestee', email: 'asha@adinn.com' };
const base = { associationId: 'a', clientEmail: '', createdAt: '2026-10-01T05:00:00.000Z', lastGiven: null, lastGivenDate: null, selectedYear: 2026, bd, type: null } as const;
const given = (over: object) => ({ _id: 'd', distributionYear: 2026, type: 'Vendor', legacyVertical: null, quantity: 2, mode: 'COURIER', status: 'SHIPPING', statusHistory: [], hasProof: false,
  deliveredAt: null, bdId: 'bd1', bdName: bd.name, bdEmail: bd.email, distributedAt: '2026-10-02T05:00:00.000Z', notes: '', ...over });
const records = [
  { ...base, _id: 'c1', clientId: 'c1', clientName: 'Courier Co', clientMobile: '9000000001', allowedQuantity: 5, isEligible: false, lastGiven: 2026,
    associations: [{ _id: 'a1', type: 'Vendor', legacyVertical: null, bd }], currentYearDistribution: given({ quantity: 2, mode: 'COURIER', status: 'SHIPPING' }) },
  { ...base, _id: 'c2', clientId: 'c2', clientName: 'Walk-in Co', clientMobile: '9000000002', allowedQuantity: 3, isEligible: false, lastGiven: 2026,
    associations: [{ _id: 'a2', type: 'Govt. Official', legacyVertical: null, bd }], currentYearDistribution: given({ type: 'Govt. Official', quantity: 3, mode: 'IN_PERSON', status: 'DELIVERED', hasProof: true }) },
  { ...base, _id: 'c3', clientId: 'c3', clientName: 'Pending Co', clientMobile: '9000000003', allowedQuantity: 1, isEligible: true,
    associations: [{ _id: 'a3', type: 'Bank Official', legacyVertical: null, bd }], currentYearDistribution: null },
  { ...base, _id: 'c4', clientId: 'c4', clientName: 'Legacy Co', clientMobile: '9000000004', allowedQuantity: 1, isEligible: false, lastGiven: 2026,
    associations: [{ _id: 'a4', type: null, legacyVertical: 'Roadshow', bd }], currentYearDistribution: given({ type: null, legacyVertical: 'Roadshow', quantity: null, mode: null, status: null }) },
] as unknown as DistributionRow[];
const filters: EntryExportFilters = { year: 2026, type: 'ALL', bd: 'ALL', status: 'ALL', mode: 'ALL', deliveryStatus: 'ALL', search: '' };

const read = async (list: DistributionRow[], over: Partial<EntryExportFilters> = {}) => {
  const blob = buildEntryWorkbook(list, [bd], { ...filters, ...over });
  const workbook = XLSX.read(new Uint8Array(await blob.arrayBuffer()), { type: 'array' });
  const table = (name: string) => XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[name], { defval: '' });
  return { workbook, details: table('Distribution Details'), summary: XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets.Summary, { header: 1, defval: '' }) };
};

async function main() {
  const { workbook, details, summary } = await read(records);
  assert.deepEqual(workbook.SheetNames, ['Summary', 'Distribution Details', 'Type Analytics', 'Requestee Analytics']); ok('sheets are renamed to Type / Requestee analytics');
  const headings = Object.keys(details[0]);
  for (const required of ['Type', 'Requestee Name', 'Requestee Email', 'Allowed Quantity', 'Distribution Quantity', 'Mode', 'Status', 'Distribution Status', 'Distribution Year', 'Last Given Year'])
    assert.ok(headings.includes(required), `missing column ${required}`);
  assert.ok(!headings.some(h => /vertical|\bBD\b/i.test(h))); ok('export has Type, Requestee Name, Allowed/Distribution Quantity, Mode and Status columns and no Vertical/BD headings');
  const byName = Object.fromEntries(details.map(row => [row['Client/Vendor Name'] as string, row]));
  assert.equal(byName['Courier Co'].Type, 'Vendor'); assert.equal(byName['Courier Co']['Requestee Name'], 'Asha Requestee');
  assert.equal(byName['Courier Co']['Allowed Quantity'], 5); assert.equal(byName['Courier Co']['Distribution Quantity'], 2);
  assert.equal(byName['Courier Co'].Mode, 'Courier'); assert.equal(byName['Courier Co'].Status, 'Shipping'); assert.equal(byName['Courier Co']['Distribution Status'], 'Given'); ok('courier row values');
  assert.equal(byName['Walk-in Co'].Mode, 'In-person'); assert.equal(byName['Walk-in Co'].Status, 'Delivered'); assert.equal(byName['Walk-in Co']['Distribution Quantity'], 3); ok('in-person row values');
  assert.equal(byName['Pending Co'].Mode, ''); assert.equal(byName['Pending Co'].Status, ''); assert.equal(byName['Pending Co']['Distribution Quantity'], ''); assert.equal(byName['Pending Co']['Distribution Status'], 'Not Given');
  assert.equal(byName['Pending Co']['Allowed Quantity'], 1); ok('undistributed row keeps Allowed Quantity and blank mode/status/quantity');
  assert.equal(byName['Legacy Co'].Type, 'Unassigned'); assert.equal(byName['Legacy Co'].Mode, ''); assert.equal(byName['Legacy Co']['Distribution Status'], 'Given'); ok('legacy row exports as Unassigned with blank mode/status');
  assert.equal(details.length, 4); ok('one row per matching client');

  const labelled = (label: string) => { const row = summary.find(cells => cells[0] === label) as unknown[]; return row; };
  assert.equal(labelled('Type')[1], 'All Types'); assert.equal((summary.find(c => c[3] === 'Requestee Name') as unknown[])[4], 'All Requestees');
  ok('summary describes the active Type / Requestee filters');
  const filtered = await read([records[0]], { type: 'Vendor', mode: 'COURIER', deliveryStatus: 'SHIPPING', search: 'Courier' });
  const modeCell = filtered.summary.find(cells => cells[3] === 'Mode / Stage') as unknown[];
  assert.equal(modeCell[4], 'Courier - Shipping'); assert.equal((filtered.summary.find(cells => cells[0] === 'Type') as unknown[])[1], 'Vendor');
  assert.equal(filtered.details.length, 1); assert.equal(filtered.details[0]['Client/Vendor Name'], 'Courier Co'); ok('export contains only the filtered rows and records the active mode/stage filter');
  const inPerson = await read([records[1]], { mode: 'IN_PERSON', deliveryStatus: 'ALL' });
  assert.equal((inPerson.summary.find(cells => cells[3] === 'Mode / Stage') as unknown[])[4], 'In-person - all stages'); ok('mode filter without a stage is described correctly');

  const types = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets['Type Analytics'], { defval: '' });
  assert.deepEqual(types.map(row => row.Type), ['Vendor', 'Client', 'Govt. Official', 'OOH Landlords', 'Bank Official']);
  assert.equal(types.find(row => row.Type === 'Vendor')!['Given'], 1); assert.equal(types.find(row => row.Type === 'Bank Official')!['Not Given'], 1); ok('Type analytics lists the five Types with correct Given / Not Given counts');

  const empty = await read([]); assert.equal(empty.details.length, 0); assert.deepEqual(Object.keys(empty.workbook.Sheets).length, 4); ok('an empty result still produces a valid workbook');
  console.log(`\n${passed} checks passed`);
}
main().catch(error => { console.error('FAIL:', error?.stack || error); process.exit(1); });
