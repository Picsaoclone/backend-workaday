/* eslint-disable no-console */

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_BASE = 'http://localhost:5000/api';

async function http(baseUrl, pathname, { method = 'GET', token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${baseUrl}${pathname}`, {
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
  const inputPath = path.join(__dirname, 'push-e2e.json');
  if (!fs.existsSync(inputPath)) {
    throw new Error('Missing tmp/push-e2e.json. Run: node tmp/push-e2e-setup.js');
  }

  const payload = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  const baseUrl = payload.baseUrl || process.env.BASE_URL || DEFAULT_BASE;

  const adminToken = payload?.admin?.token;
  const employeeId = payload?.employee?.id;

  if (!adminToken) throw new Error('push-e2e.json missing admin.token');
  if (!employeeId) throw new Error('push-e2e.json missing employee.id');

  const rand = Math.floor(Math.random() * 1e9);
  const content = `Push test message ${rand}`;

  const res = await http(baseUrl, '/messages', {
    method: 'POST',
    token: adminToken,
    body: { recipientId: employeeId, content },
  });

  console.log(JSON.stringify({ ok: true, sentMessageId: res?.data?._id, content }, null, 2));
}

main().catch((err) => {
  console.error('FAIL:', err.message);
  if (err.payload) console.error('payload:', JSON.stringify(err.payload, null, 2));
  process.exitCode = 1;
});
