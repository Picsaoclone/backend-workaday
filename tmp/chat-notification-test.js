/* eslint-disable no-console */

const BASE = process.env.BASE_URL || 'http://localhost:5000/api';

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

function findMessageNotification(notiList, predicate) {
  return (Array.isArray(notiList) ? notiList : []).find(
    (n) => n && n.type === 'message' && predicate(n)
  );
}

async function main() {
  const rand = Math.floor(Math.random() * 1e9);
  const pass = 'Password123!';
  const adminEmail = `admin_msg_${rand}@example.com`;
  const employeeEmail = `employee_msg_${rand}@example.com`;

  console.log('--- Setup users/company ---');
  const adminReg = await http('/auth/register', {
    method: 'POST',
    body: { email: adminEmail, password: pass, name: 'Admin Msg' },
  });

  await http('/companies', {
    method: 'POST',
    token: adminReg.data.token,
    body: { name: `Msg Co ${rand}`, industry: 'IT', size: '11-50' },
  });

  const adminLogin = await http('/auth/login', {
    method: 'POST',
    body: { email: adminEmail, password: pass },
  });
  const adminToken = adminLogin.data.token;
  const adminId = adminLogin.data.user._id;

  const invite = await http('/companies/my/invite-code', { token: adminToken });
  const inviteCode = invite.data.inviteCode;

  const empReg = await http('/auth/register', {
    method: 'POST',
    body: { email: employeeEmail, password: pass, name: 'Employee Msg', inviteCode },
  });
  const employeeId = empReg.data.user._id;

  const empLogin = await http('/auth/login', {
    method: 'POST',
    body: { email: employeeEmail, password: pass },
  });
  const empToken = empLogin.data.token;

  console.log({ adminId, employeeId });

  console.log('--- Create DM channel (type=dm) ---');
  const dmChannel = await http('/channels', {
    method: 'POST',
    token: adminToken,
    body: {
      name: `dm-${rand}`,
      description: 'dm channel test',
      type: 'dm',
      memberIds: [employeeId],
      dmUserIds: [adminId, employeeId],
    },
  });
  const dmChannelId = dmChannel.data._id;

  console.log({ dmChannelId });

  console.log('--- Send message to DM channel via channelId ---');
  const contentChannel = `Hi via channelId ${rand}`;
  await http('/messages', {
    method: 'POST',
    token: adminToken,
    body: { channelId: dmChannelId, content: contentChannel },
  });

  console.log('--- Send message via recipientId (true DM without channelId) ---');
  const contentDm = `Hi via recipientId ${rand}`;
  await http('/messages', {
    method: 'POST',
    token: adminToken,
    body: { recipientId: employeeId, content: contentDm },
  });

  console.log('--- Verify employee notifications ---');
  const noti = await http('/notifications', { token: empToken });

  const channelNoti = findMessageNotification(noti.data, (n) =>
    typeof n.link === 'string' && n.link.includes(`/dashboard/chat/channel/${dmChannelId}`)
  );
  if (!channelNoti) {
    throw new Error('Missing message notification for channelId-based DM channel');
  }

  const dmNoti = findMessageNotification(noti.data, (n) =>
    typeof n.link === 'string' && n.link.includes(`/dashboard/chat/dm/${adminId}`)
  );
  if (!dmNoti) {
    throw new Error('Missing message notification for recipientId-based DM');
  }

  console.log('PASS: message notifications created for channel + dm');
  console.log({ unreadCount: noti.unreadCount });
}

main().catch((err) => {
  console.error('FAIL:', err.message);
  if (err.payload) console.error('payload:', JSON.stringify(err.payload, null, 2));
  process.exitCode = 1;
});
