/* eslint-disable no-console */

const { io } = require('socket.io-client');

const BASE = process.env.BASE_URL || 'http://localhost:5000/api';
const SOCKET_URL = process.env.SOCKET_URL || 'http://localhost:5000';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function http(path, { method = 'GET', token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${BASE}${path}`, {
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
    const err = new Error(`HTTP ${method} ${path} failed: ${msg}`);
    err.status = res.status;
    err.payload = json;
    throw err;
  }

  return json;
}

function onceWithTimeout(socket, event, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timeout waiting for ${event}`));
    }, timeoutMs);

    const handler = (...args) => {
      cleanup();
      resolve(args);
    };

    const cleanup = () => {
      clearTimeout(timer);
      socket.off(event, handler);
    };

    socket.on(event, handler);
  });
}

async function main() {
  const rand = Math.floor(Math.random() * 1e9);
  const pass = 'Password123!';
  const adminEmail = `admin_rt_${rand}@example.com`;
  const employeeEmail = `employee_rt_${rand}@example.com`;

  console.log('--- Setup via REST ---');
  const adminReg = await http('/auth/register', {
    method: 'POST',
    body: { email: adminEmail, password: pass, name: 'Admin RT' },
  });
  const adminId = adminReg.data.user._id;

  await http('/companies', {
    method: 'POST',
    token: adminReg.data.token,
    body: { name: `RT Co ${rand}`, industry: 'IT', size: '11-50' },
  });

  const adminLogin = await http('/auth/login', {
    method: 'POST',
    body: { email: adminEmail, password: pass },
  });
  const adminToken = adminLogin.data.token;

  const invite = await http('/companies/my/invite-code', { token: adminToken });
  const inviteCode = invite.data.inviteCode;

  const empReg = await http('/auth/register', {
    method: 'POST',
    body: { email: employeeEmail, password: pass, name: 'Employee RT', inviteCode },
  });
  const employeeId = empReg.data.user._id;

  const empLogin = await http('/auth/login', {
    method: 'POST',
    body: { email: employeeEmail, password: pass },
  });
  const empToken = empLogin.data.token;

  const channel = await http('/channels', {
    method: 'POST',
    token: adminToken,
    body: {
      name: `rt-${rand}`,
      description: 'realtime test',
      type: 'private',
      memberIds: [employeeId],
    },
  });
  const channelId = channel.data._id;

  console.log({ adminId, employeeId, channelId });

  console.log('--- Realtime Socket.IO test ---');

  const adminSocket = io(SOCKET_URL, {
    transports: ['websocket'],
    auth: { token: adminToken },
  });
  const empSocket = io(SOCKET_URL, {
    transports: ['websocket'],
    auth: { token: empToken },
  });

  await Promise.all([
    onceWithTimeout(adminSocket, 'connect', 5000),
    onceWithTimeout(empSocket, 'connect', 5000),
  ]);

  adminSocket.emit('join_channel', channelId);
  empSocket.emit('join_channel', channelId);

  // 1) channel message
  const contentChannel = `Hello channel ${rand}`;

  const adminGotChannel = onceWithTimeout(adminSocket, 'new_message', 5000);
  const empGotChannel = onceWithTimeout(empSocket, 'new_message', 5000);

  adminSocket.emit('send_message', { channelId, content: contentChannel, type: 'text' });

  const [[adminMsg]] = await Promise.all([adminGotChannel, empGotChannel]);

  if (adminMsg.content !== contentChannel || String(adminMsg.channelId) !== String(channelId)) {
    throw new Error('Channel new_message payload mismatch (admin)');
  }

  // 2) typing indicator
  const typingWait = onceWithTimeout(adminSocket, 'user_typing', 5000);
  empSocket.emit('typing', channelId);
  const [[typingPayload]] = await Promise.all([typingWait]);
  if (String(typingPayload.channelId) !== String(channelId)) {
    throw new Error('user_typing payload mismatch');
  }

  // 3) DM message (no channelId; should still emit to both users)
  const contentDm = `Hello DM ${rand}`;
  const adminGotDm = onceWithTimeout(adminSocket, 'new_message', 5000);
  const empGotDm = onceWithTimeout(empSocket, 'new_message', 5000);

  adminSocket.emit('send_message', { recipientId: employeeId, content: contentDm, type: 'text' });
  const [[adminDm]] = await Promise.all([adminGotDm, empGotDm]);

  if (adminDm.content !== contentDm || String(adminDm.recipientId) !== String(employeeId)) {
    throw new Error('DM new_message payload mismatch (admin)');
  }

  // 4) REST history for channel includes the sent channel message
  await sleep(200);
  const history = await http(`/messages/channel/${channelId}`, { token: adminToken });
  const hasChannelMsg = Array.isArray(history.data) && history.data.some((m) => m.content === contentChannel);
  if (!hasChannelMsg) {
    throw new Error('Channel history does not include the realtime-sent message');
  }

  console.log('PASS: channel new_message, user_typing, DM new_message, and REST history.');

  adminSocket.disconnect();
  empSocket.disconnect();
}

main().catch((err) => {
  console.error('FAIL:', err.message);
  if (err.payload) console.error('payload:', JSON.stringify(err.payload, null, 2));
  process.exitCode = 1;
});
