import { Router, Response } from "express";
import { authenticate, AuthRequest } from "../middleware/auth";
import Meeting from "../models/Meeting";
import Notification from "../models/Notification";
import User from "../models/User";
import { emitInAppNotification, pushToUser } from "../services/notify";
import { callStates, cleanupCallStates } from "../socket/callState";
import { Server } from "socket.io";
import * as crypto from "crypto";

const router = Router();

const makeId = (): string => {
  try {
    // Node 18+
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anyCrypto: any = crypto as any;
    if (typeof anyCrypto.randomUUID === "function") return anyCrypto.randomUUID();
  } catch {
    // ignore
  }
  return crypto.randomBytes(16).toString("hex");
};

const normalizeParticipantIds = (raw: unknown): string[] => {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const v of raw) {
    const id = String(v || "").trim();
    if (!id) continue;
    if (!out.includes(id)) out.push(id);
  }
  return out;
};

const sendMeetingInviteNotifications = async (req: AuthRequest, meeting: any, participantIds: string[]) => {
  const companyId = String(req.user!.companyId);
  const actorId = String(req.user!.id);
  const io: Server | undefined = req.app.get("io");

  const startText = meeting.startAt ? new Date(meeting.startAt).toLocaleString("vi-VN") : "";
  const title = `Mời họp: ${String(meeting.title || "Cuộc họp")}`;
  const message = startText ? `Bạn được mời tham gia cuộc họp lúc ${startText}.` : "Bạn được mời tham gia cuộc họp.";
  const link = `/meetings/${String(meeting._id)}`;

  const receiverIds = participantIds.filter((id) => id !== actorId);
  if (receiverIds.length === 0) return;

  const notificationDocs = await Notification.insertMany(
    receiverIds.map((userId) => ({
      companyId,
      userId,
      type: "meeting_invite",
      title,
      message,
      link,
    }))
  );

  // In-app + push
  for (let i = 0; i < receiverIds.length; i++) {
    const userId = receiverIds[i];
    const notif = notificationDocs?.[i];
    emitInAppNotification(io, notif);
    await pushToUser(userId, title, message, { kind: "meeting_invite", meetingId: String(meeting._id) });
  }
};

const sendMeetingReminder = async (io: Server | undefined, meeting: any, receiverIds: string[]) => {
  const companyId = String(meeting.companyId);
  const startText = meeting.startAt ? new Date(meeting.startAt).toLocaleString("vi-VN") : "";

  const title = `Nhắc lịch họp: ${String(meeting.title || "Cuộc họp")}`;
  const message = startText ? `Cuộc họp sẽ bắt đầu lúc ${startText}.` : "Cuộc họp sắp bắt đầu.";
  const link = `/meetings/${String(meeting._id)}`;

  const notificationDocs = await Notification.insertMany(
    receiverIds.map((userId) => ({
      companyId,
      userId,
      type: "meeting_reminder",
      title,
      message,
      link,
    }))
  );

  for (let i = 0; i < receiverIds.length; i++) {
    const userId = receiverIds[i];
    const notif = notificationDocs?.[i];
    emitInAppNotification(io, notif);
    await pushToUser(userId, title, message, { kind: "meeting_reminder", meetingId: String(meeting._id) });
  }
};

const sendMeetingCallInvites = async (io: Server | undefined, meeting: any) => {
  cleanupCallStates();

  const companyId = String(meeting.companyId);
  const organizerId = String(meeting.createdBy);
  const organizer = await User.findOne({ _id: organizerId, isActive: true }).select("_id name email").lean();
  const callerName = String((organizer as any)?.name || (organizer as any)?.email || "Đồng nghiệp");

  const agoraChannelName = `c_${companyId}_m_${String(meeting._id)}`;
  const mode = meeting.callMode === "voice" ? "voice" : "video";
  const pushTitle = `Cuộc họp bắt đầu`;
  const callTitle = `Họp: ${String(meeting.title || "Cuộc họp")}`;
  const pushBody = `${callerName} đang mời bạn tham gia cuộc họp...`;
  const channelId = `meeting:${String(meeting._id)}`;

  const participants = Array.isArray(meeting.participants) ? meeting.participants : [];
  const receiverIds = participants
    .filter((p: any) => String(p?.userId || "").trim())
    .filter((p: any) => String(p.userId) !== organizerId)
    .filter((p: any) => String(p.status || "invited") !== "declined")
    .map((p: any) => String(p.userId));

  for (const recipientId of receiverIds) {
    const callId = `m_${String(meeting._id)}_${recipientId}_${makeId()}`;

    callStates.set(callId, {
      callId,
      status: "invited",
      callerId: organizerId,
      recipientId,
      channelId,
      mode,
      agoraChannelName,
      title: callTitle,
      updatedAt: Date.now(),
    });

    // In-app realtime alert if connected.
    io?.to(`user:${recipientId}`).emit("call_invite", {
      callId,
      callerId: organizerId,
      callerName,
      recipientId,
      channelId,
      mode,
      agoraChannelName,
      title: callTitle,
      createdAt: new Date().toISOString(),
    });

    // Push for background/killed cases.
    await pushToUser(recipientId, pushTitle, pushBody, {
      kind: "incoming_call",
      callId,
      callerId: organizerId,
      callerName,
      channelId,
      mode,
      agoraChannelName,
      title: callTitle,
    });
  }

  return { agoraChannelName, mode, title: callTitle };
};

router.get("/", authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const companyId = String(req.user!.companyId);
    const userId = String(req.user!.id);
    const role = String((req.user as any)?.role || "");

    const filter: any = { companyId };

    if (String(req.query.status || "").trim()) {
      filter.status = String(req.query.status);
    } else {
      filter.status = { $ne: "cancelled" };
    }

    if (role !== "admin" && role !== "manager") {
      filter.$or = [{ createdBy: userId }, { "participants.userId": userId }];
    }

    const from = typeof req.query.from === "string" ? new Date(req.query.from) : null;
    const to = typeof req.query.to === "string" ? new Date(req.query.to) : null;
    const range = typeof req.query.range === "string" ? String(req.query.range) : "";

    if (from || to) {
      filter.startAt = {};
      if (from && !isNaN(from.getTime())) filter.startAt.$gte = from;
      if (to && !isNaN(to.getTime())) filter.startAt.$lte = to;
    } else if (range === "today") {
      const now = new Date();
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      const end = new Date(now);
      end.setHours(23, 59, 59, 999);
      filter.startAt = { $gte: start, $lte: end };
    } else if (range === "upcoming") {
      filter.startAt = { $gte: new Date() };
    } else if (range === "past") {
      filter.startAt = { $lt: new Date() };
    }

    const meetings = await Meeting.find(filter).sort({ startAt: 1, createdAt: -1 });
    res.json({ success: true, data: meetings });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post("/", authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const companyId = String(req.user!.companyId);
    const createdBy = String(req.user!.id);

    const title = typeof req.body?.title === "string" ? String(req.body.title).trim() : "";
    const description = typeof req.body?.description === "string" ? String(req.body.description).trim() : "";
    const startAtRaw = req.body?.startAt;
    const startAt = startAtRaw ? new Date(startAtRaw) : null;
    const durationMinutes = Number(req.body?.durationMinutes ?? 30);
    const projectId = typeof req.body?.projectId === "string" ? String(req.body.projectId).trim() : null;
    const callMode = req.body?.callMode === "voice" ? "voice" : "video";
    const reminderMinutesBefore = Number(req.body?.reminderMinutesBefore ?? 10);

    const participantIds = normalizeParticipantIds(req.body?.participantIds);

    if (!title) {
      return res.status(400).json({ success: false, message: "Thiếu tiêu đề cuộc họp." });
    }
    if (!startAt || isNaN(startAt.getTime())) {
      return res.status(400).json({ success: false, message: "startAt không hợp lệ." });
    }
    if (!Number.isFinite(durationMinutes) || durationMinutes < 5) {
      return res.status(400).json({ success: false, message: "Thời lượng không hợp lệ." });
    }
    if (participantIds.length === 0) {
      return res.status(400).json({ success: false, message: "Vui lòng chọn ít nhất 1 người tham gia." });
    }

    // Validate users (best-effort).
    const users = await User.find({ _id: { $in: participantIds }, isActive: true }).select("_id companyId").lean();
    const allowed = new Set(
      users
        .filter((u: any) => !u?.companyId || String(u.companyId) === companyId)
        .map((u: any) => String(u._id))
    );

    const validParticipantIds = participantIds.filter((id) => allowed.has(id));
    if (validParticipantIds.length === 0) {
      return res.status(400).json({ success: false, message: "Danh sách người tham gia không hợp lệ." });
    }

    const meeting = await Meeting.create({
      companyId,
      title,
      description: description || null,
      startAt,
      durationMinutes,
      projectId: projectId || null,
      createdBy,
      reminderMinutesBefore: Number.isFinite(reminderMinutesBefore) ? reminderMinutesBefore : 10,
      callMode,
      participants: validParticipantIds.map((userId) => ({ userId, status: "invited" })),
    });

    await sendMeetingInviteNotifications(req, meeting, validParticipantIds);

    res.status(201).json({ success: true, data: meeting });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.patch("/:id/respond", authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const meetingId = String(req.params.id || "").trim();
    const status = req.body?.status === "accepted" ? "accepted" : req.body?.status === "declined" ? "declined" : null;
    if (!meetingId || !status) {
      return res.status(400).json({ success: false, message: "Thiếu dữ liệu phản hồi." });
    }

    const userId = String(req.user!.id);
    const meeting = await Meeting.findOne({ _id: meetingId, companyId: String(req.user!.companyId) });
    if (!meeting) {
      return res.status(404).json({ success: false, message: "Không tìm thấy cuộc họp." });
    }

    const p = (meeting as any).participants?.find((x: any) => String(x.userId) === userId);
    if (!p) {
      return res.status(403).json({ success: false, message: "Bạn không nằm trong danh sách tham gia." });
    }

    p.status = status;
    p.respondedAt = new Date();
    await meeting.save();

    res.json({ success: true, data: meeting });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post("/:id/start", authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const meetingId = String(req.params.id || "").trim();
    const userId = String(req.user!.id);
    const role = String((req.user as any)?.role || "");

    const meeting = await Meeting.findOne({ _id: meetingId, companyId: String(req.user!.companyId) });
    if (!meeting) {
      return res.status(404).json({ success: false, message: "Không tìm thấy cuộc họp." });
    }
    if (String((meeting as any).status) === "cancelled") {
      return res.status(400).json({ success: false, message: "Cuộc họp đã bị hủy." });
    }

    const organizerId = String((meeting as any).createdBy);
    const canStart = userId === organizerId || role === "admin" || role === "manager";
    if (!canStart) {
      return res.status(403).json({ success: false, message: "Bạn không có quyền bắt đầu cuộc họp." });
    }

    const io: Server | undefined = req.app.get("io");

    // Ensure idempotency: if already invited, just return call data.
    if (!(meeting as any).callInvitedAt) {
      (meeting as any).callInvitedAt = new Date();
      await meeting.save();

      const callData = await sendMeetingCallInvites(io, meeting);
      return res.json({ success: true, data: callData });
    }

    const callData = {
      agoraChannelName: `c_${String((meeting as any).companyId)}_m_${String((meeting as any)._id)}`,
      mode: (meeting as any).callMode === "voice" ? "voice" : "video",
      title: `Họp: ${String((meeting as any).title || "Cuộc họp")}`,
    };

    res.json({ success: true, data: callData });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

export const meetingInternals = {
  sendMeetingReminder,
  sendMeetingCallInvites,
};

export default router;
