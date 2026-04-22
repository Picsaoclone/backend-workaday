import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import compression from "compression";
import dotenv from "dotenv";

import { connectDatabase } from "./config/database";
import { errorHandler } from "./middleware/errorHandler";
import authRoutes from "./routes/auth.routes";
import userRoutes from "./routes/user.routes";

dotenv.config();

const app = express();

// Avoid conditional GET (304) responses that can break some mobile clients' caching behavior.
app.set("etag", false);

const configuredFrontendOrigin = process.env.FRONTEND_URL || "http://localhost:5173";
const extraAllowedOrigins = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const allowedOrigins = new Set([configuredFrontendOrigin, ...extraAllowedOrigins]);
const ngrokOriginPattern = /^https?:\/\/[a-z0-9-]+\.ngrok-free\.(dev|app)$/i;
const localNetworkOriginPattern = /^https?:\/\/(localhost|127\.0\.0\.1|\d{1,3}(?:\.\d{1,3}){3})(:\d+)?$/i;
const expoOriginPattern = /^exp:\/\/.+$/i;
const tauriDevOriginPattern = /^https?:\/\/tauri\.localhost(?::\d+)?$/i;

const isAllowedOrigin = (origin?: string) => {
  if (!origin) return true;
  if (allowedOrigins.has(origin)) return true;
  if (origin.startsWith("tauri://")) return true;
  if (tauriDevOriginPattern.test(origin)) return true;
  if ((process.env.NODE_ENV || "development") !== "production") {
    if (localNetworkOriginPattern.test(origin)) return true;
    if (expoOriginPattern.test(origin)) return true;
  }
  return ngrokOriginPattern.test(origin);
};

const corsOriginHandler = (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
  callback(null, isAllowedOrigin(origin));
};

// Middleware
app.use(helmet());
app.use(compression());
app.use(morgan("dev"));
app.use(
  cors({
    origin: corsOriginHandler,
    credentials: true,
  })
);
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Health check
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", message: "Workaday API đang hoạt động 🚀", timestamp: new Date() });
});

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);

// Error handler (phải đặt cuối)
app.use(errorHandler);

// Start server
const PORT = process.env.PORT || 5000;

const startServer = async () => {
  await connectDatabase();
  app.listen(PORT, () => {
    console.log(`\n🚀 Workaday API đang chạy tại http://localhost:${PORT}`);
    console.log(`🌍 Môi trường: ${process.env.NODE_ENV || "development"}\n`);
  });
};

startServer().catch((err) => {
  console.error("❌ Lỗi khởi động server:", err);
  process.exit(1);
});

export { app };
