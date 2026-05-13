/* eslint-disable no-console */

const fs = require('node:fs');
const path = require('node:path');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function main() {
  const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017';

  const inputPath = path.join(__dirname, 'push-e2e.json');
  if (!fs.existsSync(inputPath)) {
    throw new Error('Missing tmp/push-e2e.json. Run: node tmp/push-e2e-setup.js');
  }

  const payload = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  const userId = payload?.employee?.id;
  if (!userId) throw new Error('push-e2e.json missing employee.id');

  const dbName = process.env.DB_NAME || 'workaday';
  await mongoose.connect(mongoUri, { dbName });

  const PushTokenSchema = new mongoose.Schema(
    {
      userId: String,
      token: String,
      platform: String,
      lastSeenAt: Date,
    },
    { collection: 'pushtokens' }
  );

  const PushToken = mongoose.model('PushToken', PushTokenSchema);

  const tokens = await PushToken.find({ userId }).lean();

  console.log(JSON.stringify({ userId, count: tokens.length, tokens }, null, 2));

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('FAIL:', err.message);
  process.exitCode = 1;
});
