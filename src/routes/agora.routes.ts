import { Router, Response } from "express";
import { authenticate, AuthRequest } from "../middleware/auth";
import { RtcRole, RtcTokenBuilder } from "agora-token";
import { callStates, cleanupCallStates } from "../socket/callState";

const router = Router();

// POST /api/agora/token
// Cấp RTC token cho mobile/web join cuộc gọi. Token được scope theo companyId.
router.post("/token", authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const appId = process.env.AGORA_APP_ID;
    const appCertificate = process.env.AGORA_APP_CERTIFICATE;

    if (!appId || !appCertificate) {
      res.status(500).json({
        success: false,
        message: "Thiếu cấu hình Agora (AGORA_APP_ID / AGORA_APP_CERTIFICATE).",
      });
      return;
    }

    const channelNameRaw = typeof (req.body as any)?.channelName === "string" ? String((req.body as any).channelName).trim() : "";
    const uid = typeof (req.body as any)?.uid === "number" ? (req.body as any).uid : Number((req.body as any)?.uid);
    const expireSeconds =
      typeof (req.body as any)?.expireSeconds === "number" ? (req.body as any).expireSeconds : Number((req.body as any)?.expireSeconds);
    const role = typeof (req.body as any)?.role === "string" ? String((req.body as any).role) : "publisher";

    if (!channelNameRaw) {
      res.status(400).json({ success: false, message: "Thiếu channelName." });
      return;
    }

    if (!Number.isFinite(uid) || uid <= 0) {
      res.status(400).json({ success: false, message: "uid không hợp lệ." });
      return;
    }

    const companyId = req.user?.companyId;
    if (!companyId) {
      res.status(401).json({ success: false, message: "Không xác định được companyId." });
      return;
    }

    // Default: only allow joining channels in the same company.
    // Exception: allow joining an active call channel if the user is a call participant.
    const companyPrefix = `c_${companyId}_`;
    if (!channelNameRaw.startsWith(companyPrefix)) {
      cleanupCallStates();
      const me = String(req.user?.id);
      const state = Array.from(callStates.values()).find(
        (s: any) => String(s?.agoraChannelName || "") === channelNameRaw && (String(s?.callerId) === me || String(s?.recipientId) === me)
      );

      if (!state) {
        res.status(403).json({ success: false, message: "Kênh không thuộc công ty của bạn." });
        return;
      }
    }

    const expirationTimeInSeconds = Number.isFinite(expireSeconds) && expireSeconds > 0 ? expireSeconds : 3600;
    const currentTimestamp = Math.floor(Date.now() / 1000);
    const privilegeExpiredTs = currentTimestamp + expirationTimeInSeconds;

    const rtcRole = role === "subscriber" ? RtcRole.SUBSCRIBER : RtcRole.PUBLISHER;
    const token = RtcTokenBuilder.buildTokenWithUid(
      appId,
      appCertificate,
      channelNameRaw,
      uid,
      rtcRole,
      expirationTimeInSeconds,
      expirationTimeInSeconds
    );

    res.json({
      success: true,
      data: {
        appId,
        token,
        channelName: channelNameRaw,
        uid,
        expiresAt: privilegeExpiredTs,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err?.message || "Không thể tạo token Agora." });
  }
});

export default router;
