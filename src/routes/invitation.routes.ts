import { Router, Response } from "express";
import crypto from "crypto";
import { authenticate, AuthRequest, requireRole } from "../middleware/auth";
import Invitation from "../models/Invitation";
import User from "../models/User";

const router = Router();

// POST /api/invitations — admin/manager tạo lời mời
router.post("/", authenticate, requireRole("admin", "manager"), async (req: AuthRequest, res: Response) => {
  try {
    const { email, role = "employee" } = req.body;
    if (!email) return res.status(400).json({ success: false, message: "Vui lòng nhập email." });

    // Kiểm tra xem email đã tồn tại trong công ty chưa
    const existing = await User.findOne({ email: email.toLowerCase(), companyId: req.user!.companyId });
    if (existing) return res.status(400).json({ success: false, message: "Email này đã là thành viên của công ty." });

    // Huỷ lời mời cũ chưa dùng cho email này
    await Invitation.deleteMany({ companyId: req.user!.companyId, email: email.toLowerCase(), used: false });

    const code = crypto.randomBytes(16).toString("hex").toUpperCase();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 ngày

    const invitation = await Invitation.create({
      companyId: req.user!.companyId,
      email: email.toLowerCase(),
      role,
      code,
      invitedBy: req.user!.id,
      expiresAt,
    });

    res.status(201).json({ success: true, data: invitation });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/invitations — lấy danh sách lời mời của công ty
router.get("/", authenticate, requireRole("admin", "manager"), async (req: AuthRequest, res: Response) => {
  try {
    const invitations = await Invitation.find({ companyId: req.user!.companyId }).sort({ createdAt: -1 });
    res.json({ success: true, data: invitations });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/invitations/check?code=... — xác nhận mã mời (dùng trước khi đăng ký)
router.get("/check", async (req: any, res: Response) => {
  try {
    const { code } = req.query;
    if (!code) return res.status(400).json({ success: false, message: "Thiếu mã mời." });

    const invitation = await Invitation.findOne({ code: String(code).toUpperCase(), used: false });
    if (!invitation) return res.status(404).json({ success: false, message: "Mã mời không hợp lệ hoặc đã được dùng." });
    if (new Date() > invitation.expiresAt) {
      return res.status(400).json({ success: false, message: "Mã mời đã hết hạn." });
    }

    res.json({ success: true, data: { email: invitation.email, role: invitation.role, companyId: invitation.companyId } });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE /api/invitations/:id — thu hồi lời mời
router.delete("/:id", authenticate, requireRole("admin", "manager"), async (req: AuthRequest, res: Response) => {
  try {
    await Invitation.findOneAndDelete({ _id: req.params.id, companyId: req.user!.companyId });
    res.json({ success: true, message: "Đã thu hồi lời mời." });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
