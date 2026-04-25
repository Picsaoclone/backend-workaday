import { Router, Response } from "express";
import { authenticate, AuthRequest } from "../middleware/auth";
import PushToken from "../models/PushToken";
import { isValidExpoPushToken } from "../services/pushNotifications";

const router = Router();

// Register / refresh Expo push token for the current user
router.post("/register", authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const token = String(req.body?.token || "").trim();
    const platform = req.body?.platform as "ios" | "android" | "web" | undefined;
    const provider = (req.body?.provider as "expo" | "fcm" | undefined) || "expo";

    if (!token) {
      return res.status(400).json({ success: false, message: "Push token không hợp lệ." });
    }

    if (provider === "expo") {
      if (!isValidExpoPushToken(token)) {
        return res.status(400).json({ success: false, message: "Expo push token không hợp lệ." });
      }
    } else if (provider === "fcm") {
      // FCM tokens are opaque; do a minimal sanity check.
      if (token.length < 20) {
        return res.status(400).json({ success: false, message: "FCM token không hợp lệ." });
      }
    } else {
      return res.status(400).json({ success: false, message: "Provider không hợp lệ." });
    }

    await PushToken.findOneAndUpdate(
      { token },
      {
        userId: req.user!.id,
        token,
        provider,
        platform,
        lastSeenAt: new Date(),
      },
      { upsert: true, new: true }
    );

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post("/unregister", authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const token = String(req.body?.token || "").trim();
    if (!token) return res.json({ success: true });
    await PushToken.deleteOne({ token, userId: req.user!.id });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
