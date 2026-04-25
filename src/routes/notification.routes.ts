import { Router, Response } from "express";
import { authenticate, AuthRequest } from "../middleware/auth";
import Notification from "../models/Notification";

const router = Router();

router.get("/", authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const notifications = await Notification.find({ userId: req.user!.id }).sort({ createdAt: -1 }).limit(50);
    const unreadCount = await Notification.countDocuments({ userId: req.user!.id, isRead: false });
    res.json({ success: true, data: notifications, unreadCount });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.patch("/read-all", authenticate, async (req: AuthRequest, res: Response) => {
  try {
    await Notification.updateMany({ userId: req.user!.id, isRead: false }, { isRead: true, readAt: new Date() });
    res.json({ success: true, message: "Đã đọc tất cả thông báo." });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.patch("/read-by-link", authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const link = req.body?.link;
    if (!link || typeof link !== "string") {
      return res.status(400).json({ success: false, message: "Thiếu link." });
    }

    await Notification.updateMany(
      { userId: req.user!.id, link, isRead: false },
      { isRead: true, readAt: new Date() }
    );

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.patch("/:id/read", authenticate, async (req: AuthRequest, res: Response) => {
  try {
    await Notification.findByIdAndUpdate(req.params.id, { isRead: true, readAt: new Date() });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
