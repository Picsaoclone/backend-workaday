/* eslint-disable no-console */

const fs = require('node:fs');
const path = require('node:path');

const BASE = process.env.BASE_URL || 'http://localhost:5000/api';

async function http(pathname, { method = 'GET', token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${BASE}${pathname}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }

  if (!res.ok) {
    const msg = json?.message || `${res.status} ${res.statusText}`;
    const err = new Error(`HTTP ${method} ${pathname} failed: ${msg}`);
    err.status = res.status;
    err.payload = json;
    throw err;
  }

  return json;
}

async function main() {
  const rand = Math.floor(Math.random() * 1e9);
  const pass = process.env.PUSH_TEST_PASSWORD || 'Password123!';

  const adminEmail = `push_admin_${rand}@example.com`;
  const employeeEmail = `push_emp_${rand}@example.com`;

  console.log('Creating push test accounts...');

  const adminReg = await http('/auth/register', {
    method: 'POST',
    body: { email: adminEmail, password: pass, name: 'Push Admin' },
  });

  await http('/companies', {
    method: 'POST',
    token: adminReg.data.token,
    body: { name: `Push Test Co ${rand}`, industry: 'IT', size: '11-50' },
  });

  const adminLogin = await http('/auth/login', {
    method: 'POST',
    body: { email: adminEmail, password: pass },
  });

  const adminId = adminLogin.data.user._id;
  const companyId = adminLogin.data.user.companyId;
  const adminToken = adminLogin.data.token;

  const invite = await http('/companies/my/invite-code', { token: adminToken });
  const inviteCode = invite.data.inviteCode;

  const empReg = await http('/auth/register', {
    method: 'POST',
    body: { email: employeeEmail, password: pass, name: 'Push Employee', inviteCode },
  });

  const employeeId = empReg.data.user._id;

  const out = {
    createdAt: new Date().toISOString(),
    baseUrl: BASE,
    password: pass,
    admin: { email: adminEmail, id: adminId, token: adminToken },
    employee: { email: employeeEmail, id: employeeId },
    companyId,
    inviteCode,
  };

  const outPath = path.join(__dirname, 'push-e2e.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');

  console.log('Saved:', outPath);
  console.log('Admin:', adminEmail);
  console.log('Employee:', employeeEmail);
  console.log('Password:', pass);
  console.log('EmployeeId:', employeeId);
}

main().catch((err) => {
  console.error('FAIL:', err.message);
  if (err.payload) console.error('payload:', JSON.stringify(err.payload, null, 2));
  process.exitCode = 1;
});
