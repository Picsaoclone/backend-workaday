import { Server } from "socket.io";
import { getUserExpoPushTokenRows, getUserFcmTokens, sendPushToTokens } from "./pushNotifications";
import { sendFcmDataToTokens } from "./fcmNotifications";
import Notification from "../models/Notification";

export type MobileNotificationData =
  | { kind: "task_assigned"; taskId: string }
  | { kind: "meeting_invite"; meetingId: string }
  | { kind: "meeting_reminder"; meetingId: string }
  | { kind: "project_added"; projectId: string }
  | { kind: "chat_channel"; channelId: string; channelName?: string }
  | { kind: "chat_dm"; contactId: string; contactName?: string }
  | {
      kind: "incoming_call";
      callId: string;
      callerId: string;
      callerName?: string;
      channelId: string;
      mode: "voice" | "video";
      agoraChannelName: string;
      title?: string;
    };

export const emitInAppNotification = (io: Server | undefined, notification: any): void => {
  if (!io || !notification?.userId) return;
  io.to(`user:${String(notification.userId)}`).emit("notification:new", notification);
};

export const pushToUser = async (
  userId: string,
  title: string,
  body: string,
  data: MobileNotificationData
): Promise<void> => {
  const isIncomingCall = data?.kind === "incoming_call";
  const incomingCallChannelId = "calls_incoming_v2";

  // Android "call-like" incoming calls: prefer FCM data-only delivery when configured.
  // This enables a background handler to show a full-screen incoming call UI even if the app is killed.
  if (isIncomingCall) {
    const fcmTokens = await getUserFcmTokens(userId);
    if (fcmTokens.length > 0) {
      console.log("[push] incoming_call: attempting FCM", { userId, fcmTokens: fcmTokens.length });
      const fcmSent = await sendFcmDataToTokens(fcmTokens, {
        ...data,
        title,
        body,
      });

      console.log("[push] incoming_call: FCM result", { userId, fcmSent });

      if (fcmSent) {
        // Avoid double-notifying Android devices: if FCM succeeded,
        // only send Expo push to non-Android platforms (e.g. iOS).
        const expoRows = await getUserExpoPushTokenRows(userId);
        const expoNonAndroid = expoRows
          .filter((r) => r.platform !== "android")
          .map((r) => r.token);

        await sendPushToTokens(expoNonAndroid, {
          title,
          body,
          data,
          ...(isIncomingCall ? { channelId: incomingCallChannelId, priority: "high" } : {}),
        });
        return;
      }

      // FCM configured but failed (or misconfigured): fall back to standard Expo push.
      console.log("[push] incoming_call: falling back to Expo", { userId });
    }
  }

  // Non-call pushes: include iOS badge count when available.
  // Avoid badge updates for incoming calls so the icon doesn't increment just because a call arrived.
  const expoRows = await getUserExpoPushTokenRows(userId);
  const tokens = expoRows.map((r) => r.token);

  let badge: number | undefined;
  if (!isIncomingCall) {
    const hasIos = expoRows.some((r) => r.platform === "ios");
    if (hasIos) {
      try {
        badge = await Notification.countDocuments({ userId, isRead: false });
      } catch {
        badge = undefined;
      }
    }
  }

  await sendPushToTokens(tokens, {
    title,
    body,
    data,
    ...(typeof badge === "number" ? { badge } : {}),
    // Android: route to the high-importance call channel so sound/vibrate works.
    ...(isIncomingCall ? { channelId: incomingCallChannelId, priority: "high" } : {}),
  });
};
