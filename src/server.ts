import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import compression from "compression";
import { createServer } from "http";
import { Server as SocketIOServer } from "socket.io";
import dotenv from "dotenv";

import { connectDatabase } from "./config/database";
import authRoutes from "./routes/auth.routes";
import companyRoutes from "./routes/company.routes";
import userRoutes from "./routes/user.routes";
import projectRoutes from "./routes/project.routes";
import taskRoutes from "./routes/task.routes";
import attendanceRoutes from "./routes/attendance.routes";
import leaveRoutes from "./routes/leave.routes";
import reportRoutes from "./routes/report.routes";
import messageRoutes from "./routes/message.routes";
import channelRoutes from "./routes/channel.routes";
import notificationRoutes from "./routes/notification.routes";
import pushTokenRoutes from "./routes/pushToken.routes";
import uploadRoutes from "./routes/upload.routes";
import invitationRoutes from "./routes/invitation.routes";
import departmentRoutes from "./routes/department.routes";
import agoraRoutes from "./routes/agora.routes";
import callRoutes from "./routes/call.routes";
import friendRoutes from "./routes/friend.routes";
import meetingRoutes from "./routes/meeting.routes";
import documentRoutes from "./routes/document.routes";
import { errorHandler } from "./middleware/errorHandler";
import { setupSocketHandlers } from "./socket/socketHandlers";
import { startMeetingScheduler } from "./services/meetingScheduler";

dotenv.config();

const app = express();
const httpServer = createServer(app);

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

// Socket.IO setup
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: corsOriginHandler,
    methods: ["GET", "POST"],
    credentials: true,
  },
});

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

// Gắn io vào request để dùng trong controllers
app.set("io", io);

// Health check
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", message: "Workaday API đang hoạt động 🚀", timestamp: new Date() });
});

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/companies", companyRoutes);
app.use("/api/users", userRoutes);
app.use("/api/projects", projectRoutes);
app.use("/api/tasks", taskRoutes);
app.use("/api/attendance", attendanceRoutes);
app.use("/api/leave", leaveRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/messages", messageRoutes);
app.use("/api/channels", channelRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/push-tokens", pushTokenRoutes);
app.use("/api/upload", uploadRoutes);
app.use("/api/invitations", invitationRoutes);
app.use("/api/departments", departmentRoutes);
app.use("/api/agora", agoraRoutes);
app.use("/api/calls", callRoutes);
app.use("/api/friends", friendRoutes);
app.use("/api/meetings", meetingRoutes);
app.use("/api/documents", documentRoutes);

// Socket handlers
setupSocketHandlers(io);

// Error handler (phải đặt cuối)
app.use(errorHandler);

// Start server
const PORT = process.env.PORT || 5000;

const startServer = async () => {
  await connectDatabase();
  httpServer.listen(PORT, () => {
    console.log(`\n🚀 Workaday API đang chạy tại http://localhost:${PORT}`);
    console.log(`📡 Socket.IO sẵn sàng tại http://localhost:${PORT}`);
    console.log(`🌍 Môi trường: ${process.env.NODE_ENV || "development"}\n`);
  });

  // Background scheduler: meeting reminders + auto call invites.
  startMeetingScheduler(io);
};

startServer().catch((err) => {
  console.error("❌ Lỗi khởi động server:", err);
  process.exit(1);
});

export { io };
