// Run from the frontend folder: npm test   (bundled with esbuild, then run under Node)
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { parseImportRows, toImportRecords } from '../src/utils/excelImport';
import type { BD } from '../src/types';

let passed = 0;
const ok = (label: string) => { passed++; console.log(`PASS: ${label}`); };
const bds: BD[] = [
  { _id: 'b1', name: 'Asha Requestee', email: 'asha@adinn.co.in' }, { _id: 'b2', name: 'Ravi K', email: 'ravi@adinn.co.in' },
  { _id: 'b3', name: 'Twin Name', email: 'twin1@adinn.co.in' }, { _id: 'b4', name: 'Twin  name', email: 'twin2@adinn.co.in' },
];
const sheet = (rows: unknown[][]) => XLSX.utils.sheet_to_json<Record<string, unknown>>(XLSX.utils.aoa_to_sheet(rows), { defval: '' });

const rows = parseImportRows(sheet([
  ['Client/Vendor Name', 'mobile number', 'EMAIL ID', 'Type', 'Requestee Email', 'Allowed Quantity'],
  ['Ok One', '9876543210', 'a@x.com', 'vendor', 'ASHA@adinn.co.in', 3],
  ['Ok Two', '9876543211', '', 'Govt. Official', 'ravi k', ''],
  ['Valid Three', '9876543212', '', 'Client', 'asha@adinn.co.in', ''],
  ['Bad Phone', '12', '', 'Client', 'asha@adinn.co.in', ''],
  ['Short Phone', '987654321', '', 'Client', 'asha@adinn.co.in', ''],
  ['Long Phone', '98765432100', '', 'Client', 'asha@adinn.co.in', ''],
  ['Plus91 Phone', '+919876543210', '', 'Client', 'asha@adinn.co.in', ''],
  ['Spaced Phone', '98765 43210', '', 'Client', 'asha@adinn.co.in', ''],
  ['Letter Phone', '98765abc10', '', 'Client', 'asha@adinn.co.in', ''],
  ['Bad Email', '9876543213', 'nope', 'Client', 'asha@adinn.co.in', ''],
  ['Old Vertical', '9876543214', '', 'Roadshow', 'asha@adinn.co.in', ''],
  ['No Type', '9876543215', '', '', 'asha@adinn.co.in', ''],
  ['No Requestee', '9876543216', '', 'Client', '', ''],
  ['Unknown Requestee', '9876543217', '', 'Client', 'ghost@adinn.co.in', ''],
  ['Twin', '9876543218', '', 'Client', 'twin name', ''],
  ['Zero Qty', '9876543219', '', 'Client', 'asha@adinn.co.in', 0],
  ['Decimal Qty', '9876543220', '', 'Client', 'asha@adinn.co.in', '2.5'],
  ['Ok One', '9876543210', '', 'Vendor', 'asha@adinn.co.in', ''],
  ['Ok One', '9876543210', '', 'Bank Official', 'asha@adinn.co.in', ''],
]), bds);
const reason = (name: string) => rows.find(row => row.name === name)!;
assert.equal(rows[0].status, 'valid'); assert.equal(rows[0].type, 'Vendor'); assert.equal(rows[0].requestee, 'asha@adinn.co.in'); assert.equal(rows[0].allowedQuantity, 3);
assert.equal(rows[1].status, 'valid'); assert.equal(rows[1].requestee, 'ravi@adinn.co.in'); assert.equal(rows[1].allowedQuantity, 1);
ok('headers are matched case/spacing-insensitively; Type and Requestee (email or name) resolve; quantity defaults to 1');
for (const [name, text] of [['Bad Phone', /10 digits/], ['Short Phone', /10 digits/], ['Long Phone', /10 digits/], ['Plus91 Phone', /10 digits/], ['Spaced Phone', /10 digits/], ['Letter Phone', /10 digits/], ['Bad Email', /email/i], ['Old Vertical', /Unknown type/], ['No Type', /Missing type/], ['No Requestee', /Missing requestee/], ['Unknown Requestee', /not found/], ['Twin', /ambiguous/], ['Zero Qty', /quantity/i], ['Decimal Qty', /quantity/i]] as const) {
  assert.equal(reason(name).status, 'invalid', name); assert.match(reason(name).reason, text, name);
}
assert.equal(parseImportRows(sheet([['Client/Vendor Name', 'Mobile Number', 'Type', 'Requestee Email'], ['', '9876543212', 'Client', 'asha@adinn.co.in']]), bds)[0].reason, 'Missing name');
ok('bad rows are flagged with a specific reason (name, phone, email, old vertical, type, requestee, ambiguous requestee, quantity)');
const okOnes = rows.filter(row => row.name === 'Ok One'); assert.deepEqual(okOnes.map(row => row.status), ['valid', 'duplicate', 'valid']); ok('same client + Type + Requestee twice is a duplicate; the same client under another Type is not');
const records = toImportRecords(rows);
assert.equal(records.length, 4); assert.deepEqual(records[0], { name: 'Ok One', mobile: '9876543210', email: 'a@x.com', type: 'Vendor', requestee: 'asha@adinn.co.in', allowedQuantity: 3 });
ok('only valid rows are sent, in the shape the API expects');
assert.deepEqual(parseImportRows([], bds), []); ok('an empty sheet yields no rows');
console.log(`\n${passed} checks passed`);
