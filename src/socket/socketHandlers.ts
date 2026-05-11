import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import Message from "../models/Message";
import Channel from "../models/Channel";
import User from "../models/User";
import { pushNewChatMessage } from "../services/chatPush";
import { normalizeMessageAttachments } from "../utils/messageAttachments";
import { pushToUser } from "../services/notify";
import { callStates, cleanupCallStates } from "./callState";
import { areFriends } from "../utils/friends";

type CallState = import("./callState").CallState;

export const setupSocketHandlers = (io: Server): void => {
  // Xác thực socket bằng JWT
  io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error("Chưa xác thực"));
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET || "workaday_secret_key") as any;
      socket.data.user = decoded;
      next();
    } catch {
      next(new Error("Token không hợp lệ"));
    }
  });

  io.on("connection", (socket) => {
    const user = socket.data.user;
    console.log(`🔌 User kết nối: ${user.email}`);

    // Join vào company room
    socket.join(`company:${user.companyId}`);

    // Join channel rooms
    socket.on("join_channel", (channelId: string) => {
      socket.join(`channel:${channelId}`);
    });

    socket.on("leave_channel", (channelId: string) => {
      socket.leave(`channel:${channelId}`);
    });

    // --- Call signaling (Agora) ---
    // Caller -> server -> callee: call_invite
    // Callee -> server -> caller: call_accept | call_reject
    // Caller -> server -> callee: call_cancel
    // Either side -> server -> other: call_end
    socket.on(
      "call_invite",
      async (
        data: {
        callId: string;
        recipientId: string;
        channelId?: string;
        mode: "voice" | "video";
        agoraChannelName: string;
        title?: string;
        },
        ack?: (resp: { ok: boolean; message?: string }) => void
      ) => {
        try {
          cleanupCallStates();
          const callId = String(data?.callId || "").trim();
          const recipientId = String(data?.recipientId || "").trim();
          const channelId = typeof (data as any)?.channelId === "string" ? String((data as any).channelId).trim() : "";
          const mode = data?.mode;
          const agoraChannelName = String(data?.agoraChannelName || "").trim();
          const title = data?.title ? String(data.title) : undefined;

          if (!callId || !recipientId || !agoraChannelName) {
            socket.emit("call_error", { message: "Thiếu dữ liệu cuộc gọi." });
            ack?.({ ok: false, message: "Thiếu dữ liệu cuộc gọi." });
            return;
          }
          if (mode !== "voice" && mode !== "video") {
            socket.emit("call_error", { message: "Mode cuộc gọi không hợp lệ." });
            ack?.({ ok: false, message: "Mode cuộc gọi không hợp lệ." });
            return;
          }

          const expectedPrefix = `c_${String(user.companyId)}_`;
          if (!agoraChannelName.startsWith(expectedPrefix)) {
            socket.emit("call_error", { message: "Kênh cuộc gọi không hợp lệ." });
            ack?.({ ok: false, message: "Kênh cuộc gọi không hợp lệ." });
            return;
          }

          const recipient = await User.findOne({ _id: recipientId, isActive: true })
            .select("_id name email companyId")
            .lean();
          if (!recipient) {
            socket.emit("call_error", { message: "Không tìm thấy người nhận cuộc gọi." });
            ack?.({ ok: false, message: "Không tìm thấy người nhận cuộc gọi." });
            return;
          }

          const recipientCompanyId = (recipient as any)?.companyId ? String((recipient as any).companyId) : null;
          const isSameCompany = recipientCompanyId && recipientCompanyId === String(user.companyId);
          if (!isSameCompany) {
            const ok = await areFriends(String(user.id), recipientId);
            if (!ok) {
              socket.emit("call_error", { message: "Chỉ có thể gọi người ngoài công ty sau khi đã kết bạn." });
              ack?.({ ok: false, message: "Chỉ có thể gọi người ngoài công ty sau khi đã kết bạn." });
              return;
            }
          }

          callStates.set(callId, {
            callId,
            status: "invited",
            callerId: String(user.id),
            recipientId,
            channelId,
            mode,
            agoraChannelName,
            title,
            updatedAt: Date.now(),
          });

          io.to(`user:${recipientId}`).emit("call_invite", {
            callId,
            callerId: String(user.id),
            callerName: String((user as any)?.name || (user as any)?.email || "Đồng nghiệp"),
            recipientId,
            channelId,
            mode,
            agoraChannelName,
            title,
            createdAt: new Date().toISOString(),
          });

          // Push notification for background/killed app cases.
          const callerName = String((user as any)?.name || (user as any)?.email || "Đồng nghiệp");
          const pushTitle = title || (mode === "video" ? "Cuộc gọi video" : "Cuộc gọi");
          const pushBody = `${callerName} đang gọi...`;
          void pushToUser(recipientId, pushTitle, pushBody, {
            kind: "incoming_call",
            callId,
            callerId: String(user.id),
            callerName,
            channelId,
            mode,
            agoraChannelName,
            title,
          }).catch(() => undefined);

          ack?.({ ok: true });
        } catch (err) {
          socket.emit("call_error", { message: "Không thể bắt đầu cuộc gọi." });
          ack?.({ ok: false, message: "Không thể bắt đầu cuộc gọi." });
        }
      }
    );

    socket.on(
      "call_accept",
      (
        data: {
        callId: string;
        callerId: string;
        channelId?: string;
        mode: "voice" | "video";
        agoraChannelName: string;
        title?: string;
        },
        ack?: (resp: { ok: boolean; message?: string }) => void
      ) => {
        cleanupCallStates();
        const callId = String(data?.callId || "").trim();
        const callerId = String(data?.callerId || "").trim();
        if (!callId || !callerId) {
          ack?.({ ok: false, message: "Thiếu dữ liệu cuộc gọi." });
          return;
        }

        const existing = callStates.get(callId);
        const recipientId = existing?.recipientId || String(user.id);
        callStates.set(callId, {
          callId,
          status: "accepted",
          callerId,
          recipientId,
          channelId: typeof (data as any)?.channelId === "string" ? String((data as any).channelId) : String(existing?.channelId || ""),
          mode: data?.mode || existing?.mode,
          agoraChannelName: String(data?.agoraChannelName || existing?.agoraChannelName || ""),
          title: data?.title ? String(data.title) : existing?.title,
          acceptedByUserId: String(user.id),
          updatedAt: Date.now(),
        });

        io.to(`user:${callerId}`).emit("call_accept", {
          callId,
          callerId,
          acceptedByUserId: String(user.id),
          acceptedByName: String((user as any)?.name || (user as any)?.email || "Đồng nghiệp"),
          channelId: typeof (data as any)?.channelId === "string" ? String((data as any).channelId) : "",
          mode: data?.mode,
          agoraChannelName: String(data?.agoraChannelName || ""),
          title: data?.title ? String(data.title) : undefined,
          acceptedAt: new Date().toISOString(),
        });

        ack?.({ ok: true });
      }
    );

    socket.on(
      "call_reject",
      (
        data: { callId: string; callerId: string; reason?: string },
        ack?: (resp: { ok: boolean; message?: string }) => void
      ) => {
        cleanupCallStates();
        const callId = String(data?.callId || "").trim();
        const callerId = String(data?.callerId || "").trim();
        if (!callId || !callerId) {
          ack?.({ ok: false, message: "Thiếu dữ liệu cuộc gọi." });
          return;
        }

        try {
          const existing = callStates.get(callId);
          console.log("[calls] call_reject", {
            callId,
            callerId,
            byUserId: String(user.id),
            byName: String((user as any)?.name || (user as any)?.email || "unknown"),
            reason: data?.reason ? String(data.reason) : undefined,
            mode: existing?.mode,
          });
        } catch {
          // ignore
        }

        const existing = callStates.get(callId);
        callStates.set(callId, {
          callId,
          status: "rejected",
          callerId,
          recipientId: existing?.recipientId || String(user.id),
          channelId: existing?.channelId,
          mode: existing?.mode,
          agoraChannelName: existing?.agoraChannelName,
          title: existing?.title,
          updatedAt: Date.now(),
        });

        io.to(`user:${callerId}`).emit("call_reject", {
          callId,
          callerId,
          rejectedByUserId: String(user.id),
          rejectedByName: String((user as any)?.name || (user as any)?.email || "Đồng nghiệp"),
          reason: data?.reason ? String(data.reason) : undefined,
          rejectedAt: new Date().toISOString(),
        });

        ack?.({ ok: true });
      }
    );

    socket.on(
      "call_cancel",
      (
        data: { callId: string; recipientId: string },
        ack?: (resp: { ok: boolean; message?: string }) => void
      ) => {
        cleanupCallStates();
        const callId = String(data?.callId || "").trim();
        const recipientId = String(data?.recipientId || "").trim();
        if (!callId || !recipientId) {
          ack?.({ ok: false, message: "Thiếu dữ liệu cuộc gọi." });
          return;
        }

        const existing = callStates.get(callId);
        callStates.set(callId, {
          callId,
          status: "cancelled",
          callerId: existing?.callerId || String(user.id),
          recipientId,
          channelId: existing?.channelId,
          mode: existing?.mode,
          agoraChannelName: existing?.agoraChannelName,
          title: existing?.title,
          updatedAt: Date.now(),
        });

        io.to(`user:${recipientId}`).emit("call_cancel", {
          callId,
          callerId: String(user.id),
          cancelledAt: new Date().toISOString(),
        });

        ack?.({ ok: true });
      }
    );

    socket.on(
      "call_end",
      (
        data: { callId: string; otherUserId: string },
        ack?: (resp: { ok: boolean; message?: string }) => void
      ) => {
        cleanupCallStates();
        const callId = String(data?.callId || "").trim();
        const otherUserId = String(data?.otherUserId || "").trim();
        if (!callId || !otherUserId) {
          ack?.({ ok: false, message: "Thiếu dữ liệu cuộc gọi." });
          return;
        }

        const existing = callStates.get(callId);
        callStates.set(callId, {
          callId,
          status: "ended",
          callerId: existing?.callerId || String(user.id),
          recipientId: existing?.recipientId || otherUserId,
          channelId: existing?.channelId,
          mode: existing?.mode,
          agoraChannelName: existing?.agoraChannelName,
          title: existing?.title,
          updatedAt: Date.now(),
        });

        io.to(`user:${otherUserId}`).emit("call_end", {
          callId,
          endedByUserId: String(user.id),
          endedByName: String((user as any)?.name || (user as any)?.email || "Đồng nghiệp"),
          endedAt: new Date().toISOString(),
        });

        ack?.({ ok: true });
      }
    );

    // Fetch call state (prevents missing call_accept due to race conditions).
    socket.on(
      "call_get",
      (
        data: { callId: string },
        ack?: (resp: { ok: boolean; message?: string; state?: CallState | null }) => void
      ) => {
        cleanupCallStates();
        const callId = String(data?.callId || "").trim();
        if (!callId) {
          ack?.({ ok: false, message: "Thiếu callId." });
          return;
        }

        const state = callStates.get(callId) || null;
        if (!state) {
          ack?.({ ok: true, state: null });
          return;
        }

        const me = String(user.id);
        if (me !== state.callerId && me !== state.recipientId) {
          ack?.({ ok: false, message: "Forbidden" });
          return;
        }

        ack?.({ ok: true, state });
      }
    );

    // Gửi tin nhắn qua socket (realtime)
    socket.on("send_message", async (data: {
      channelId?: string;
      recipientId?: string;
      content: string;
      type?: string;
      attachments?: unknown;
    }) => {
      try {
        const truncate = (value: string, maxLen: number) => {
          const clean = String(value || "").trim();
          if (clean.length <= maxLen) return clean;
          return `${clean.slice(0, Math.max(0, maxLen - 1))}…`;
        };

        const attachments = normalizeMessageAttachments(data.attachments);
        const msgType = attachments.length > 0
          ? (attachments[0].resourceType === "image" ? "image" : "file")
          : (data.type || "text");

        let channelId: string | undefined = data.channelId;
        const recipientId: string | undefined = data.recipientId;

        // Ensure DM messages always have a channelId so clients can fetch history by channel.
        if (!channelId && recipientId) {
          const senderId = String(user.id);
          const recipient = String(recipientId);

          const recipientUser = await User.findOne({ _id: recipient, isActive: true }).select("_id name companyId").lean();
          if (!recipientUser) {
            socket.emit("error", { message: "Không tìm thấy người nhận." });
            return;
          }

          const myCompanyId = String((user as any).companyId);
          const recipientCompanyId = (recipientUser as any)?.companyId ? String((recipientUser as any).companyId) : null;
          const isSameCompany = recipientCompanyId && recipientCompanyId === myCompanyId;
          if (!isSameCompany) {
            const ok = await areFriends(senderId, recipient);
            if (!ok) {
              socket.emit("error", { message: "Chỉ có thể nhắn tin người ngoài công ty sau khi đã kết bạn." });
              return;
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
            const members = Array.isArray((existed as any).memberIds) ? (existed as any).memberIds.map(String) : [];
            if (!members.includes(senderId) || !members.includes(recipient)) {
              await Channel.findByIdAndUpdate(existed._id, {
                $addToSet: { memberIds: { $each: [senderId, recipient] } },
              });
            }

            const dmUserIds = Array.isArray((existed as any).dmUserIds) ? (existed as any).dmUserIds.map(String) : [];
            if (dmUserIds.length !== 2 || !dmUserIds.includes(senderId) || !dmUserIds.includes(recipient)) {
              await Channel.findByIdAndUpdate(existed._id, { dmUserIds: [senderId, recipient] });
            }
          } else {
            const channelName = `DM · ${String((recipientUser as any)?.name || "Chat")}`;
            const created = await Channel.create({
              companyId: user.companyId,
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

        const message = await Message.create({
          companyId: user.companyId,
          senderId: user.id,
          channelId,
          recipientId,
          content: data.content,
          type: msgType,
          attachments,
        });

        if (channelId) {
          const previewText = attachments.length > 0
            ? (msgType === "image" ? "(Ảnh)" : "(Tệp)")
            : (truncate(String(data.content || ""), 140) || "(Tin nhắn mới)");

          await Channel.findByIdAndUpdate(channelId, {
            lastMessageAt: new Date(),
            lastMessageText: previewText,
            lastMessageSenderId: String(user.id),
            lastMessageType: msgType,
          });
          io.to(`channel:${channelId}`).emit("new_message", message);

          void pushNewChatMessage({
            senderId: String(user.id),
            channelId: String(channelId),
            content: String(data.content || ""),
          }).catch((err) => console.warn("pushNewChatMessage failed", err));
        } else if (recipientId) {
          // DM - gửi cho cả hai user
          io.to(`user:${String(user.id)}`).emit("new_message", message);
          io.to(`user:${String(recipientId)}`).emit("new_message", message);

          void pushNewChatMessage({
            senderId: String(user.id),
            recipientId: String(recipientId),
            content: String(data.content || ""),
          }).catch((err) => console.warn("pushNewChatMessage failed", err));
        }
      } catch (err) {
        socket.emit("error", { message: "Không thể gửi tin nhắn." });
      }
    });

    // Delivery receipt (best-effort): recipient notifies server when a DM message is received.
    // Server then forwards that to the sender so the sender can show "Đã nhận".
    socket.on(
      "message_received",
      async (
        data: { messageId: string },
        ack?: (resp: { ok: boolean; message?: string }) => void
      ) => {
        try {
          const messageId = String(data?.messageId || "").trim();
          if (!messageId) {
            ack?.({ ok: false, message: "Thiếu messageId." });
            return;
          }

          const msg = await Message.findById(messageId).select("_id senderId channelId").lean();
          if (!msg) {
            ack?.({ ok: false, message: "Không tìm thấy tin nhắn." });
            return;
          }

          const senderId = String((msg as any).senderId || "");
          const channelId = String((msg as any).channelId || "");
          if (!senderId || !channelId) {
            ack?.({ ok: false, message: "Tin nhắn không hợp lệ." });
            return;
          }

          const me = String(user.id);
          if (me === senderId) {
            ack?.({ ok: true });
            return;
          }

          const channel = await Channel.findById(channelId).select("type memberIds dmUserIds").lean();
          if (!channel) {
            ack?.({ ok: false, message: "Không tìm thấy kênh." });
            return;
          }

          if (String((channel as any).type) !== "dm") {
            // Only support DM receipts for now.
            ack?.({ ok: true });
            return;
          }

          const members: string[] = Array.isArray((channel as any).memberIds) ? (channel as any).memberIds.map(String) : [];
          if (!members.includes(me) || !members.includes(senderId)) {
            ack?.({ ok: false, message: "Forbidden" });
            return;
          }

          io.to(`user:${senderId}`).emit("message_received", {
            messageId,
            channelId,
            byUserId: me,
          });

          ack?.({ ok: true });
        } catch {
          ack?.({ ok: false, message: "Không thể cập nhật trạng thái." });
        }
      }
    );

    // Typing indicator
    socket.on("typing", (channelId: string) => {
      socket.to(`channel:${channelId}`).emit("user_typing", { userId: user.id, channelId });
    });

    socket.on("stop_typing", (channelId: string) => {
      socket.to(`channel:${channelId}`).emit("user_stop_typing", { userId: user.id, channelId });
    });

    // User join personal room để nhận DM
    socket.join(`user:${user.id}`);

    socket.on("disconnect", () => {
      console.log(`🔌 User ngắt kết nối: ${user.email}`);
    });
  });
};
