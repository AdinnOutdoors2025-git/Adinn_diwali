// Run from the backend folder: node node_modules/tsx/dist/cli.mjs ../frontend/tests/diwali-year.test.ts
import assert from 'node:assert/strict';
import { getYearPolicy, FIRST_DIWALI_YEAR } from '../src/config/diwaliYear';

const at = (iso: string) => new Date(iso);
let passed = 0;
const ok = (label: string) => { passed++; console.log(`PASS: ${label}`); };

const p26 = getYearPolicy({ now: at('2026-10-26T10:00:00') });
assert.equal(p26.operatingYear, 2026);
assert.deepEqual(p26.years, [2026, 2027, 2028, 2029]);
ok('2026: default 2026, selector 2026-2029');
assert.ok(!p26.years.some(year => year < 2026));
ok('no year before 2026 is offered');
const early = getYearPolicy({ now: at('2025-03-01T00:00:00') });
assert.equal(early.operatingYear, 2026);
assert.equal(Math.min(...early.years), 2026);
ok('a clock before 2026 is clamped to 2026');
const p27 = getYearPolicy({ now: at('2027-01-01T00:00:00') });
assert.equal(p27.operatingYear, 2027);
assert.deepEqual(p27.years, [2026, 2027, 2028, 2029, 2030]);
ok('2027 becomes the default and 2030 appears automatically, with no source edit');
assert.equal(getYearPolicy({ now: at('2027-06-15T00:00:00'), rollover: '08-01' }).operatingYear, 2026);
ok('configurable rollover 08-01: June 2027 still operates on 2026');
assert.equal(getYearPolicy({ now: at('2027-08-01T00:00:00'), rollover: '08-01' }).operatingYear, 2027);
ok('configurable rollover 08-01: 1 Aug 2027 switches to 2027');
assert.equal(getYearPolicy({ now: at('2030-05-05T00:00:00'), operatingYear: 2027 }).operatingYear, 2027);
ok('operating year can be pinned explicitly');
assert.equal(getYearPolicy({ now: at('2026-10-26T00:00:00'), rollover: 'garbage' }).operatingYear, 2026);
ok('an invalid rollover falls back safely to 01-01');
assert.equal(FIRST_DIWALI_YEAR, 2026);
console.log(`\n${passed} checks passed`);
