import assert from 'node:assert/strict';
import { assertJwtConfig, generateToken, jwtSecretProblem, verifyToken } from '../src/config/jwt.js';

let checks = 0;
const ok = (label: string) => { checks += 1; console.log(`PASS: ${label}`); };
const payload = { id: '1', name: 'Staff', email: 'staff@example.com', role: 'STAFF' as const };
const strong = 'x7Qp2mV9aLr4TzWc8NhY1bKd5GfJ3sUe6RoI0ByA';

const withEnv = (env: Record<string, string | undefined>, run: () => void) => {
  const saved = { NODE_ENV: process.env.NODE_ENV, JWT_SECRET: process.env.JWT_SECRET };
  for (const [key, value] of Object.entries(env)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  try { run(); } finally { for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
};

assert.equal(jwtSecretProblem(strong), null); ok('a long random secret is accepted');
for (const bad of [undefined, '', '   ', 'short', 'adinn_diwali_jwt_super_secret_key_2026', '<generate-a-long-random-secret>', 'REPLACE_WITH_A_LONG_RANDOM_VALUE_123456']) {
  assert.ok(jwtSecretProblem(bad), `should reject ${JSON.stringify(bad)?.slice(0, 20)}`);
}
ok('missing, blank, short, published and placeholder secrets are rejected');

for (const secret of [undefined, 'short', 'adinn_diwali_jwt_super_secret_key_2026']) {
  withEnv({ NODE_ENV: 'production', JWT_SECRET: secret }, () => {
    assert.throws(() => assertJwtConfig(), /JWT_SECRET/);
    assert.throws(() => generateToken(payload), /JWT_SECRET/);
  });
}
ok('production startup and token signing fail clearly without a secure JWT_SECRET');

withEnv({ NODE_ENV: 'production', JWT_SECRET: strong }, () => {
  assert.doesNotThrow(() => assertJwtConfig());
  assert.equal(verifyToken(generateToken(payload)).email, payload.email);
});
ok('production works with a strong secret');

withEnv({ NODE_ENV: 'development', JWT_SECRET: undefined }, () => {
  assert.doesNotThrow(() => assertJwtConfig());
  assert.equal(verifyToken(generateToken(payload)).id, '1');
});
ok('development without a secret still works using a temporary random one');

withEnv({ NODE_ENV: 'development', JWT_SECRET: 'dev-secret' }, () => {
  const token = generateToken(payload);
  process.env.JWT_SECRET = 'another-dev-secret';
  assert.throws(() => verifyToken(token));
});
ok('tokens signed with one secret do not verify with another');

console.log(`${checks} checks passed`);
