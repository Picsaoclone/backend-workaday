/* eslint-disable no-console */

const mongoose = require('mongoose');
require('dotenv').config();

async function main() {
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) throw new Error('Missing MONGODB_URI');

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

  const total = await PushToken.countDocuments({});
  const latest = await PushToken.find({})
    .sort({ lastSeenAt: -1, _id: -1 })
    .limit(10)
    .lean();

  console.log(JSON.stringify({ total, latest }, null, 2));

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('FAIL:', err.message);
  process.exitCode = 1;
});
