/* eslint-disable no-console */
const path = require('path');
const dotenv = require('dotenv');
const mongoose = require('mongoose');

async function main() {
  // Ensure dotenv loads backend/.env (when run from repo root or elsewhere).
  process.chdir(path.resolve(__dirname, '..'));
  dotenv.config();

  const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017';
  const dbName = process.env.DB_NAME || 'workaday';

  const email = '123@gmail.com'.toLowerCase().trim();
  const nextRole = 'admin';

  await mongoose.connect(mongoUri, { dbName });

  const users = mongoose.connection.db.collection('users');
  const before = await users.findOne({ email });

  if (!before) {
    console.error(`❌ Không tìm thấy user email=${email}`);
    process.exitCode = 1;
    return;
  }

  if (before.role === nextRole) {
    console.log(`✅ User ${email} đã là '${nextRole}' rồi (id=${before._id}).`);
    return;
  }

  const result = await users.updateOne(
    { _id: before._id },
    { $set: { role: nextRole } }
  );

  console.log(`✅ Updated role for ${email}: '${before.role}' -> '${nextRole}'`);
  console.log(`   matched=${result.matchedCount} modified=${result.modifiedCount} id=${before._id}`);
}

main()
  .catch((err) => {
    console.error('❌ Lỗi khi chạy script:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await mongoose.disconnect();
    } catch {
      // ignore
    }
  });
