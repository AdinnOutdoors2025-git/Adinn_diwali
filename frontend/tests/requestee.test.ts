// Run from the frontend folder: npm test   (bundled with esbuild, then run under Node)
import assert from 'node:assert/strict';
import { seedRequestee, validateRequestee } from '../src/utils/requestee';
import type { BD } from '../src/types';

let passed = 0;
const ok = (label: string) => { passed++; console.log(`PASS: ${label}`); };
const existing: BD[] = [{ _id: 'b1', name: 'Asha Requestee', email: 'asha@adinn.co.in' }, { _id: 'b2', name: 'Ravi  K', email: 'ravi@adinn.co.in' }];

assert.deepEqual(validateRequestee('Meera Nair', 'meera@adinn.co.in', existing), {}); ok('a new name and email pass');
assert.equal(validateRequestee('', 'meera@adinn.co.in', existing).name, 'Requestee Name is required.');
assert.equal(validateRequestee('   ', 'meera@adinn.co.in', existing).name, 'Requestee Name is required.');
assert.match(validateRequestee('N'.repeat(121), 'meera@adinn.co.in', existing).name!, /120/); ok('blank and overlong names are flagged');
assert.equal(validateRequestee('Meera', '', existing).email, 'Email ID is required.');
for (const bad of ['meera', 'meera@', '@adinn.co.in', 'me era@adinn.co.in', 'meera@adinn']) assert.equal(validateRequestee('Meera', bad, existing).email, 'Enter a valid email address.', bad);
ok('missing and malformed emails are flagged');
const byEmail = validateRequestee('Different Name', ' ASHA@adinn.co.in ', existing);
assert.match(byEmail.email!, /already exists: Asha Requestee/); assert.equal(byEmail.duplicate?._id, 'b1'); ok('a duplicate email (any case, padded) is flagged and the existing Requestee is returned');
const byName = validateRequestee('  ravi k ', 'new.ravi@adinn.co.in', existing);
assert.match(byName.name!, /already exists/); assert.equal(byName.duplicate?._id, 'b2'); ok('a duplicate name (case and spacing) is flagged');
assert.equal(validateRequestee('', 'asha@adinn.co.in', existing).duplicate?._id, 'b1'); ok('a duplicate is still reported when another field is also invalid');
assert.deepEqual(seedRequestee('  Meera Nair '), { name: 'Meera Nair', email: '' }); assert.deepEqual(seedRequestee('meera@adinn.co.in'), { name: '', email: 'meera@adinn.co.in' });
ok('the search term seeds the name, or the email when it contains @');
console.log(`\n${passed} checks passed`);
