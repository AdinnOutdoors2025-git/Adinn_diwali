import dotenv from 'dotenv';
dotenv.config();

const API_BASE = 'http://localhost:5000/api';

async function runTests() {
  console.log('--- Starting API Integration Tests ---');

  // 1. Staff Login
  console.log('1. Testing Staff Login...');
  const staffLoginRes = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'staff@adinn.com', password: 'Staff@123', role: 'STAFF' }),
  });
  const staffAuth: any = await staffLoginRes.json();
  if (!staffAuth.success || !staffAuth.token) {
    throw new Error(`Staff login failed: ${JSON.stringify(staffAuth)}`);
  }
  const token = staffAuth.token;
  console.log('✓ Staff Login successful, token acquired.');

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };

  // 2. CMD Login
  console.log('2. Testing CMD Login...');
  const cmdLoginRes = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'cmd@adinn.com', password: 'Cmd@123', role: 'CMD' }),
  });
  const cmdAuth: any = await cmdLoginRes.json();
  if (!cmdAuth.success || !cmdAuth.token) {
    throw new Error(`CMD login failed: ${JSON.stringify(cmdAuth)}`);
  }
  console.log('✓ CMD Login successful.');

  // 3. Create or Fetch BD
  console.log('3. Fetching BDs...');
  let bdRes = await fetch(`${API_BASE}/bds`, { headers });
  let bdData: any = await bdRes.json();
  let activeBD = bdData.data?.[0];

  if (!activeBD) {
    const newBDRes = await fetch(`${API_BASE}/bds`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'Integration Test BD', email: `bd.${Date.now()}@adinn.com` }),
    });
    const newBDData: any = await newBDRes.json();
    activeBD = newBDData.data;
  }
  console.log(`✓ Active BD: ${activeBD.name} (${activeBD._id})`);

  // 4. Create Client
  console.log('4. Creating Client under Vertical "Roadshow"...');
  const createClientRes = await fetch(`${API_BASE}/clients`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      vertical: 'Roadshow',
      bd: activeBD._id,
      name: `Unique Corp ${Date.now()}`,
      mobile: `98${Math.floor(10000000 + Math.random() * 90000000)}`,
      email: 'corp@test.com',
    }),
  });
  const createdClient: any = await createClientRes.json();
  if (!createdClient.success) {
    throw new Error(`Create Client failed: ${JSON.stringify(createdClient)}`);
  }
  console.log(`✓ Client "${createdClient.data.name}" created (No sweet distribution created).`);
  const clientId = createdClient.data.clientId;

  // 5. Verify Sweet Distribution
  console.log('5. Recording Sweet Distribution for year 2026...');
  const distRes = await fetch(`${API_BASE}/distributions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      clientId,
      year: 2026,
      vertical: 'Roadshow',
      bd: activeBD._id,
      notes: 'Delivered Royal Kaju Katli Box',
    }),
  });
  const distData: any = await distRes.json();
  if (!distData.success) {
    throw new Error(`Distribution failed: ${JSON.stringify(distData)}`);
  }
  console.log(`✓ 2026 Sweet distribution recorded successfully.`);

  // 6. Test Duplicate Prevention for same year
  console.log('6. Testing duplicate distribution prevention for year 2026 (same client under different vertical)...');
  const dupDistRes = await fetch(`${API_BASE}/distributions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      clientId,
      year: 2026,
      vertical: 'Outdoor',
      bd: activeBD._id,
    }),
  });
  if (dupDistRes.status === 409) {
    console.log('✓ Duplicate distribution successfully blocked (HTTP 409 Conflict).');
  } else {
    throw new Error(`Expected 409 for duplicate distribution in 2026, got ${dupDistRes.status}`);
  }

  // 7. Verify Client becomes eligible in 2027
  console.log('7. Recording distribution for year 2027 (eligible again next year)...');
  const dist2027Res = await fetch(`${API_BASE}/distributions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      clientId,
      year: 2027,
      vertical: 'Roadshow',
      bd: activeBD._id,
    }),
  });
  const dist2027Data: any = await dist2027Res.json();
  if (!dist2027Data.success) {
    throw new Error(`2027 distribution failed: ${JSON.stringify(dist2027Data)}`);
  }
  console.log('✓ 2027 distribution recorded successfully (Client eligible in subsequent years).');

  console.log('\n--- ALL API INTEGRATION TESTS PASSED! ---');
}

runTests().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
