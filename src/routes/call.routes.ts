import { Router, Response } from "express";
import { authenticate, AuthRequest } from "../middleware/auth";
import User from "../models/User";
import { callStates, cleanupCallStates } from "../socket/callState";
import type { Server as SocketIOServer } from "socket.io";

const router = Router();

// POST /api/calls/accept
router.post("/accept", authenticate, async (req: AuthRequest, res: Response) => {
  try {
    cleanupCallStates();
    const callId = typeof (req.body as any)?.callId === "string" ? String((req.body as any).callId).trim() : "";
    if (!callId) {
      res.status(400).json({ success: false, message: "Thiếu callId." });
      return;
    }

    const state = callStates.get(callId);
    if (!state) {
      res.status(404).json({ success: false, message: "Cuộc gọi không tồn tại hoặc đã hết hạn." });
      return;
    }

    const me = String(req.user!.id);
    if (me !== String(state.recipientId)) {
      res.status(403).json({ success: false, message: "Forbidden" });
      return;
    }

    if (state.status === "cancelled" || state.status === "ended" || state.status === "rejected") {
      res.status(409).json({ success: false, message: "Cuộc gọi đã kết thúc hoặc bị hủy." });
      return;
    }

    const meUser = await User.findById(me).select("name email").lean();
    const acceptedByName = String((meUser as any)?.name || (meUser as any)?.email || req.user!.email || "Đồng nghiệp");

    callStates.set(callId, {
      ...state,
      status: "accepted",
      acceptedByUserId: me,
      updatedAt: Date.now(),
    });

    const io = req.app.get("io") as SocketIOServer | undefined;
    io?.to(`user:${String(state.callerId)}`).emit("call_accept", {
      callId,
      callerId: String(state.callerId),
      acceptedByUserId: me,
      acceptedByName,
      channelId: String(state.channelId || ""),
      mode: state.mode,
      agoraChannelName: String(state.agoraChannelName || ""),
      title: state.title ? String(state.title) : undefined,
      acceptedAt: new Date().toISOString(),
    });

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err?.message || "Server error" });
  }
});

// POST /api/calls/reject
router.post("/reject", authenticate, async (req: AuthRequest, res: Response) => {
  try {
    cleanupCallStates();
    const callId = typeof (req.body as any)?.callId === "string" ? String((req.body as any).callId).trim() : "";
    const reason = typeof (req.body as any)?.reason === "string" ? String((req.body as any).reason).trim() : undefined;

    if (!callId) {
      res.status(400).json({ success: false, message: "Thiếu callId." });
      return;
    }

    const state = callStates.get(callId);
    if (!state) {
      res.status(404).json({ success: false, message: "Cuộc gọi không tồn tại hoặc đã hết hạn." });
      return;
    }

    const me = String(req.user!.id);
    if (me !== String(state.recipientId)) {
      res.status(403).json({ success: false, message: "Forbidden" });
      return;
    }

    if (state.status === "cancelled" || state.status === "ended") {
      res.status(409).json({ success: false, message: "Cuộc gọi đã kết thúc hoặc bị hủy." });
      return;
    }

    const meUser = await User.findById(me).select("name email").lean();
    const rejectedByName = String((meUser as any)?.name || (meUser as any)?.email || req.user!.email || "Đồng nghiệp");

    callStates.set(callId, {
      ...state,
      status: "rejected",
      updatedAt: Date.now(),
    });

    const io = req.app.get("io") as SocketIOServer | undefined;
    io?.to(`user:${String(state.callerId)}`).emit("call_reject", {
      callId,
      callerId: String(state.callerId),
      rejectedByUserId: me,
      rejectedByName,
      reason: reason || undefined,
      rejectedAt: new Date().toISOString(),
    });

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err?.message || "Server error" });
  }
});

export default router;
