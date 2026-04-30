import { Router, Response } from "express";
import { authenticate, AuthRequest } from "../middleware/auth";
import Message from "../models/Message";
import Channel from "../models/Channel";
import User from "../models/User";
import { pushNewChatMessage } from "../services/chatPush";
import { normalizeMessageAttachments } from "../utils/messageAttachments";
import { areFriends } from "../utils/friends";

const router = Router();

// GET messages trong channel
router.get("/channel/:channelId", authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const channelId = String(req.params.channelId);
    const me = String(req.user!.id);
    const companyId = String(req.user!.companyId);

    const channel = await Channel.findById(channelId).select("_id companyId type memberIds").lean();
    if (!channel) {
      return res.status(404).json({ success: false, message: "Không tìm thấy kênh." });
    }

    const memberIds: string[] = Array.isArray((channel as any).memberIds) ? (channel as any).memberIds.map(String) : [];
    const isMember = memberIds.includes(me);

    if (String((channel as any).type) === "dm") {
      if (!isMember) {
        return res.status(403).json({ success: false, message: "Forbidden" });
      }
    } else {
      if (String((channel as any).companyId) !== companyId) {
        return res.status(403).json({ success: false, message: "Forbidden" });
      }
      const isPublic = String((channel as any).type) === "public";
      if (!isPublic && !isMember) {
        return res.status(403).json({ success: false, message: "Forbidden" });
      }
    }

    // Return the latest messages (busy channels can have thousands).
    // Keep response ordered from oldest -> newest for easier client rendering.
    const messages = await Message.find({
      channelId,
      deletedAt: null,
    })
      .sort({ createdAt: -1 })
      .limit(100);

    res.json({ success: true, data: messages.reverse() });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST gửi tin nhắn (REST fallback, realtime qua Socket.IO)
router.post("/", authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const truncate = (value: string, maxLen: number) => {
      const clean = String(value || "").trim();
      if (clean.length <= maxLen) return clean;
      return `${clean.slice(0, Math.max(0, maxLen - 1))}…`;
    };

    const attachments = normalizeMessageAttachments(req.body.attachments);
    const msgType = attachments.length > 0
      ? (attachments[0].resourceType === "image" ? "image" : "file")
      : (req.body.type || "text");

    let channelId: string | undefined = req.body.channelId;
    const recipientId: string | undefined = req.body.recipientId;

    // Ensure 1-1 messages are always stored in a DM channel so clients can load history by channelId.
    if (!channelId && recipientId) {
      const senderId = String(req.user!.id);
      const recipient = String(recipientId);

      const recipientUser = await User.findOne({ _id: recipient, isActive: true }).select("_id name companyId").lean();
      if (!recipientUser) {
        return res.status(404).json({ success: false, message: "Không tìm thấy người nhận." });
      }

      const myCompanyId = String(req.user!.companyId);
      const recipientCompanyId = (recipientUser as any)?.companyId ? String((recipientUser as any).companyId) : null;
      const isSameCompany = recipientCompanyId && recipientCompanyId === myCompanyId;
      if (!isSameCompany) {
        const ok = await areFriends(senderId, recipient);
        if (!ok) {
          return res.status(403).json({ success: false, message: "Chỉ có thể nhắn tin người ngoài công ty sau khi đã kết bạn." });
        }
      }

      const existed = await Channel.findOne({
        type: "dm",
        $or: [
          { dmUserIds: { $all: [senderId, recipient] } },
          { memberIds: { $all: [senderId, recipient] } },
        ],
      }).select("_id memberIds dmUserIds name");

      if (existed) {
        channelId = existed._id.toString();
        // Best-effort: keep memberIds consistent.
        const members = Array.isArray((existed as any).memberIds) ? (existed as any).memberIds.map(String) : [];
        if (!members.includes(senderId) || !members.includes(recipient)) {
          await Channel.findByIdAndUpdate(existed._id, { $addToSet: { memberIds: { $each: [senderId, recipient] } } });
        }
        // Best-effort: fill dmUserIds for older data.
        const dmUserIds = Array.isArray((existed as any).dmUserIds) ? (existed as any).dmUserIds.map(String) : [];
        if (dmUserIds.length !== 2 || !dmUserIds.includes(senderId) || !dmUserIds.includes(recipient)) {
          await Channel.findByIdAndUpdate(existed._id, { dmUserIds: [senderId, recipient] });
        }
      } else {
        const channelName = `DM · ${String((recipientUser as any)?.name || "Chat")}`;
        const created = await Channel.create({
          companyId: req.user!.companyId,
          name: channelName,
          type: "dm",
          memberIds: [senderId, recipient],
          adminIds: [senderId],
          dmUserIds: [senderId, recipient],
          createdBy: senderId,
          lastMessageAt: new Date(),
        });
        channelId = created._id.toString();
      }
    }

    let messageCompanyId = String(req.user!.companyId);
    if (channelId) {
      const channel = await Channel.findById(channelId).select("companyId type memberIds").lean();
      if (!channel) {
        return res.status(404).json({ success: false, message: "Không tìm thấy kênh." });
      }
      const memberIds: string[] = Array.isArray((channel as any).memberIds) ? (channel as any).memberIds.map(String) : [];
      if (String((channel as any).type) === "dm") {
        if (!memberIds.includes(String(req.user!.id))) {
          return res.status(403).json({ success: false, message: "Forbidden" });
        }
      } else {
        if (String((channel as any).companyId) !== String(req.user!.companyId)) {
          return res.status(403).json({ success: false, message: "Forbidden" });
        }
      }

      if ((channel as any).companyId) messageCompanyId = String((channel as any).companyId);
    }

    const message = await Message.create({
      companyId: messageCompanyId,
      senderId: req.user!.id,
      channelId,
      recipientId,
      content: req.body.content,
      type: msgType,
      attachments,
      replyTo: req.body.replyTo,
    });
    // Cập nhật lastMessageAt cho channel
    if (channelId) {
      const previewText = attachments.length > 0
        ? (msgType === "image" ? "(Ảnh)" : "(Tệp)")
        : (truncate(String(req.body.content || ""), 140) || "(Tin nhắn mới)");

      await Channel.findByIdAndUpdate(channelId, {
        lastMessageAt: new Date(),
        lastMessageText: previewText,
        lastMessageSenderId: String(req.user!.id),
        lastMessageType: msgType,
      });
    }
    // Emit qua socket
    const io = req.app.get("io");

    if (io && channelId) {
      io.to(`channel:${channelId}`).emit("new_message", message);
    } else if (io && recipientId) {
      // Backward-compat: emit to both sides if channelId isn't present.
      io.to(`user:${String(req.user!.id)}`).emit("new_message", message);
      io.to(`user:${String(recipientId)}`).emit("new_message", message);
    }

    if (channelId) {
      void pushNewChatMessage({
        senderId: String(req.user!.id),
        channelId: String(channelId),
        content: String(req.body.content || ""),
      }).catch((err) => console.warn("pushNewChatMessage failed", err));
    } else if (recipientId) {
      void pushNewChatMessage({
        senderId: String(req.user!.id),
        recipientId: String(recipientId),
        content: String(req.body.content || ""),
      }).catch((err) => console.warn("pushNewChatMessage failed", err));
    }
    res.status(201).json({ success: true, data: message });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
