import FriendRequest from "../models/FriendRequest";

export const toId = (value: unknown): string => String(value ?? "").trim();

export const normalizePhone = (raw: unknown): string => {
  const digits = String(raw ?? "")
    .trim()
    .replace(/[^0-9]/g, "");

  // Minimal VN-friendly normalization: +84xxxxxxxxx -> 0xxxxxxxxx
  if (digits.startsWith("84") && digits.length >= 10) {
    return `0${digits.slice(2)}`;
  }
  return digits;
};

export const areFriends = async (userA: string, userB: string): Promise<boolean> => {
  const a = toId(userA);
  const b = toId(userB);
  if (!a || !b) return false;
  if (a === b) return true;

  const accepted = await FriendRequest.findOne({
    status: "accepted",
    $or: [
      { requesterId: a, recipientId: b },
      { requesterId: b, recipientId: a },
    ],
  })
    .select("_id")
    .lean();

  return Boolean(accepted);
};
