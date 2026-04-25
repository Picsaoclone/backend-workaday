import { Expo, ExpoPushMessage } from "expo-server-sdk";
import PushToken from "../models/PushToken";

const EXPO_PUSH_ENDPOINT = "https://api.expo.dev/v2/push/send";

const maskToken = (token: string): string => {
  const value = String(token || "");
  if (value.length <= 16) return value;
  return `${value.slice(0, 10)}…${value.slice(-6)}`;
};

export const isValidExpoPushToken = (token: string): boolean => {
  try {
    return Expo.isExpoPushToken(token);
  } catch {
    return false;
  }
};

export const getUserPushTokens = async (userId: string): Promise<string[]> => {
  const rows = await getUserExpoPushTokenRows(userId);
  return rows.map((r) => r.token).filter(Boolean);
};

export const getUserExpoPushTokenRows = async (
  userId: string
): Promise<Array<{ token: string; platform?: "ios" | "android" | "web" }>> => {
  const rows = await PushToken.find({ userId }).select("token provider platform").lean();
  return rows
    .filter((r: any) => String(r.provider || "expo") === "expo")
    .map((r: any) => ({ token: String(r.token), platform: r.platform }))
    .filter((r: any) => Boolean(r.token));
};

export const getUserFcmTokens = async (userId: string): Promise<string[]> => {
  const rows = await PushToken.find({ userId }).select("token provider").lean();
  return rows
    .filter((r: any) => String(r.provider || "expo") === "fcm")
    .map((r) => String((r as any).token))
    .filter(Boolean);
};

export const sendPushToTokens = async (tokens: string[], payload: Omit<ExpoPushMessage, "to">): Promise<void> => {
  const deduped = Array.from(new Set(tokens)).filter(isValidExpoPushToken);
  if (deduped.length === 0) return;

  const messages: ExpoPushMessage[] = deduped.map((to) => ({
    to,
    sound: "default",
    ...payload,
  }));

  // Expo recommends sending at most 100 notifications per request.
  const chunks: ExpoPushMessage[][] = [];
  for (let i = 0; i < messages.length; i += 100) {
    chunks.push(messages.slice(i, i + 100));
  }

  for (const chunk of chunks) {
    try {
      const res = await fetch(EXPO_PUSH_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(chunk),
      });

      const json: any = await res.json().catch(() => null);
      const tickets: any[] = Array.isArray(json?.data) ? json.data : [];

      if (!res.ok) {
        console.warn("Push send failed", { status: res.status, payload: json });
        continue;
      }

      for (let i = 0; i < tickets.length; i++) {
        const ticket = tickets[i];
        if (!ticket) continue;
        if (ticket.status === "error") {
          const to = (chunk[i] as any)?.to;
          console.warn("Expo push ticket error", {
            to: to ? maskToken(String(to)) : undefined,
            message: ticket.message,
            details: ticket.details,
          });
        }
      }
    } catch (err) {
      // Ignore to avoid breaking main flow; token cleanup can be added later.
      console.warn("Push send failed", err);
    }
  }
};

export const sendPushToUser = async (userId: string, payload: Omit<ExpoPushMessage, "to">): Promise<void> => {
  const tokens = await getUserPushTokens(userId);
  await sendPushToTokens(tokens, payload);
};
