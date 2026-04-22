import { Router, Response } from "express";
import { authenticate, AuthRequest, requireRole } from "../middleware/auth";
import User from "../models/User";
import { normalizePhone } from "../utils/friends";
import mongoose from "mongoose";

const router = Router();

// GET /api/users/reviewers - danh sách người có thể duyệt đơn (manager/admin)
router.get("/reviewers", authenticate, async (req: AuthRequest, res: Response) => {
  try {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");

    const companyId = String(req.user!.companyId || "").trim();
    if (!companyId) {
      return res.json({ success: true, data: [] });
    }

    const companyMatch: any[] = [{ companyId }];
    if (mongoose.Types.ObjectId.isValid(companyId)) {
      companyMatch.push({ companyId: new mongoose.Types.ObjectId(companyId) });
    }

    const reviewers = await User.find({
      $or: companyMatch,
      isActive: { $ne: false },
      role: { $in: ["manager", "admin"] },
    }).select("name email role");

    res.json({
      success: true,
      data: reviewers.map((u: any) => ({ _id: String(u._id), name: u.name, email: u.email, role: u.role })),
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/users - lấy danh sách nhân viên trong công ty
router.get("/", authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const users = await User.find({ companyId: req.user!.companyId, isActive: true }).select("-password");
    res.json({ success: true, data: users });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/users/:id
router.get("/:id", authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const user = await User.findById(req.params.id).select("-password");
    if (!user) return res.status(404).json({ success: false, message: "Không tìm thấy người dùng." });
    res.json({ success: true, data: user });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PATCH /api/users/:id - cập nhật profile / phân quyền (admin)
router.patch("/:id", authenticate, async (req: AuthRequest, res: Response) => {
  try {
    if (req.user!.id !== req.params.id && req.user!.role !== "admin") {
      return res.status(403).json({ success: false, message: "Không có quyền cập nhật." });
    }

    const targetUser = await User.findById(req.params.id);
    if (!targetUser) return res.status(404).json({ success: false, message: "Không tìm thấy người dùng." });

    if (String(targetUser.companyId) !== String(req.user!.companyId)) {
      return res.status(403).json({ success: false, message: "Không có quyền cập nhật người dùng ngoài công ty." });
    }

    const { name, phone, avatar, position, bio, departmentId, role, jobRoleKey, managerId, isActive } = req.body;

    // Admin không được tự đổi role của bản thân.
    if (req.user!.role === "admin" && req.user!.id === req.params.id && typeof role !== "undefined") {
      return res.status(400).json({ success: false, message: "Admin không thể đổi role cho chính mình." });
    }

    // Không được gán quyền admin cho người khác (chỉ có thể được set bằng seed/script).
    if (req.user!.role === "admin" && req.user!.id !== req.params.id && role === "admin") {
      return res.status(400).json({ success: false, message: "Không thể gán quyền admin cho người khác." });
    }

    const effectiveRole = typeof role !== "undefined" ? role : targetUser.role;

    // Vai trò công việc (jobRoleKey) chỉ áp dụng cho employee.
    if (typeof jobRoleKey !== "undefined") {
      if (req.user!.role !== "admin") {
        return res.status(403).json({ success: false, message: "Chỉ admin mới được gán vai trò công việc." });
      }
      if (req.user!.id === req.params.id) {
        return res.status(400).json({ success: false, message: "Không thể gán vai trò công việc cho chính mình." });
      }
      if (effectiveRole !== "employee") {
        return res.status(400).json({ success: false, message: "Chỉ employee mới cần/được gán vai trò công việc." });
      }
    }

    const patch: any = {
      name,
      phone: typeof phone === "undefined" ? undefined : normalizePhone(phone),
      avatar,
      position,
      bio,
      departmentId,
    };

    // jobRoleKey: chỉ admin + chỉ employee mới được set (đã kiểm tra ở trên)
    if (typeof jobRoleKey !== "undefined") {
      patch.jobRoleKey = jobRoleKey;
    }

    // Chỉ admin mới được đổi vai trò / manager / trạng thái hoạt động
    if (req.user!.role === "admin") {
      if (role) patch.role = role;
      if (typeof managerId !== "undefined") patch.managerId = managerId;
      if (typeof isActive === "boolean") patch.isActive = isActive;
    }

    // Khi chuyển sang manager/admin thì không cần jobRoleKey nữa.
    if (typeof role !== "undefined" && role !== "employee") {
      patch.jobRoleKey = null;
    }

    Object.keys(patch).forEach((k) => typeof patch[k] === "undefined" && delete patch[k]);

    const user = await User.findByIdAndUpdate(req.params.id, patch, { new: true }).select("-password");
    res.json({ success: true, data: user });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
