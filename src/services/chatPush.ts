import Channel from "../models/Channel";
import Notification from "../models/Notification";
import User from "../models/User";
import { pushToUser } from "./notify";

const truncate = (value: string, maxLen: number) => {
  const clean = String(value || "").trim();
  if (clean.length <= maxLen) return clean;
  return `${clean.slice(0, Math.max(0, maxLen - 1))}…`;
};

export const pushNewChatMessage = async (params: {
  senderId: string;
  channelId?: string;
  recipientId?: string;
  content: string;
}): Promise<void> => {
  const senderId = String(params.senderId);
  const sender = await User.findById(senderId).select("name companyId").lean();
  const senderName = (sender as any)?.name || "Ai đó";
  const senderCompanyId = (sender as any)?.companyId ? String((sender as any).companyId) : null;

  const contentPreview = truncate(params.content || "", 140) || "(Tin nhắn mới)";

  if (params.channelId) {
    const channelId = String(params.channelId);
    const channel = await Channel.findById(channelId).select("name memberIds companyId type dmUserIds").lean();
    if (!channel) return;

    const memberIds: string[] = Array.isArray((channel as any).memberIds) ? (channel as any).memberIds.map(String) : [];
    const recipients = memberIds.filter((id) => id && id !== senderId);

    const companyId = (channel as any)?.companyId ? String((channel as any).companyId) : senderCompanyId;

    // DM channels should generate DM-style notification links so the mobile app can bold unread DM previews.
    if (String((channel as any)?.type) === "dm") {
      if (companyId && recipients.length > 0) {
        await Notification.insertMany(
          recipients.map((userId) => ({
            companyId,
            userId,
            type: "message",
            title: senderName,
            message: contentPreview,
            link: `/dashboard/chat/dm/${senderId}`,
            isRead: false,
          }))
        );
      }

      await Promise.all(
        recipients.map((userId) =>
          pushToUser(userId, senderName, contentPreview, {
            kind: "chat_dm",
            contactId: senderId,
            contactName: senderName,
          })
        )
      );
      return;
    }

    if (companyId && recipients.length > 0) {
      await Notification.insertMany(
        recipients.map((userId) => ({
          companyId,
          userId,
          type: "message",
          title: `#${(channel as any).name || "channel"}`,
          message: `${senderName}: ${contentPreview}`,
          link: `/dashboard/chat/channel/${channelId}`,
          isRead: false,
        }))
      );
    }

    const title = `#${(channel as any).name || "channel"}`;
    const body = `${senderName}: ${contentPreview}`;

    await Promise.all(
      recipients.map((userId) =>
        pushToUser(userId, title, body, {
          kind: "chat_channel",
          channelId,
          channelName: (channel as any).name,
        })
      )
    );
    return;
  }

  if (params.recipientId) {
    const recipientId = String(params.recipientId);
    if (!recipientId || recipientId === senderId) return;

    if (senderCompanyId) {
      await Notification.create({
        companyId: senderCompanyId,
        userId: recipientId,
        type: "message",
        title: senderName,
        message: contentPreview,
        link: `/dashboard/chat/dm/${senderId}`,
        isRead: false,
      });
    }

    const title = senderName;
    const body = contentPreview;

    await pushToUser(recipientId, title, body, {
      kind: "chat_dm",
      contactId: senderId,
      contactName: senderName,
    });
  }
};
