import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

export const connectDatabase = async (): Promise<void> => {
  const nodeEnv = process.env.NODE_ENV || "development";
  const mongoUri = process.env.MONGODB_URI;

  if (!mongoUri) {
    if (nodeEnv === "production") {
      throw new Error("❌ MONGODB_URI chưa được cấu hình trong .env");
    }

    // Local dev fallback: use a local MongoDB instance if present.
    // This keeps dev setup simple while still failing fast in production.
    process.env.MONGODB_URI = "mongodb://127.0.0.1:27017";
    console.warn("⚠️  MONGODB_URI chưa cấu hình. Đang fallback về mongodb://127.0.0.1:27017 (development)");
  }

  try {
    mongoose.set("strictQuery", false);

    await mongoose.connect(process.env.MONGODB_URI!, {
      dbName: process.env.DB_NAME || "workaday",
    });

    console.log("✅ Kết nối MongoDB thành công!");
    console.log(`📦 Database: ${process.env.DB_NAME || "workaday"}`);

    mongoose.connection.on("error", (error) => {
      console.error("❌ Lỗi kết nối MongoDB:", error);
    });

    mongoose.connection.on("disconnected", () => {
      console.warn("⚠️  MongoDB bị ngắt kết nối. Đang thử kết nối lại...");
    });
  } catch (error) {
    console.error("❌ Không thể kết nối MongoDB:", error);
    throw error;
  }
};
