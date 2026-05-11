export type CallStatus = "invited" | "accepted" | "rejected" | "cancelled" | "ended";

export type CallState = {
  callId: string;
  status: CallStatus;
  callerId: string;
  recipientId: string;
  channelId?: string;
  mode?: "voice" | "video";
  agoraChannelName?: string;
  title?: string;
  acceptedByUserId?: string;
  updatedAt: number;
};

export const CALL_STATE_TTL_MS = 5 * 60 * 1000;
export const callStates = new Map<string, CallState>();

export const cleanupCallStates = () => {
  const now = Date.now();
  for (const [callId, state] of callStates.entries()) {
    if (now - state.updatedAt > CALL_STATE_TTL_MS) callStates.delete(callId);
  }
};
