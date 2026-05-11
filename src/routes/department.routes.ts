import { Router, Response } from "express";
import { authenticate, AuthRequest, requireRole } from "../middleware/auth";
import Department from "../models/Department";
import User from "../models/User";

const router = Router();

// GET /api/departments — lấy danh sách phòng ban kèm số nhân viên
router.get("/", authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const [departments, users] = await Promise.all([
      Department.find({ companyId: req.user!.companyId }).sort({ name: 1 }),
      User.find({ companyId: req.user!.companyId, isActive: true }).select("_id name departmentId"),
    ]);

    const membersMap: Record<string, { _id: string; name: string }[]> = {};
    users.forEach((u: any) => {
      const dId = u.departmentId;
      if (dId) {
        if (!membersMap[dId]) membersMap[dId] = [];
        membersMap[dId].push({ _id: u._id.toString(), name: u.name });
      }
    });

    const result = departments.map(d => ({
      ...d.toObject(),
      members: membersMap[d._id.toString()] || [],
      memberCount: (membersMap[d._id.toString()] || []).length,
    }));

    res.json({ success: true, data: result });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/departments — tạo phòng ban mới (admin only)
router.post("/", authenticate, requireRole("admin"), async (req: AuthRequest, res: Response) => {
  try {
    const { name, description, managerId, color } = req.body;
    if (!name) return res.status(400).json({ success: false, message: "Tên phòng ban không được để trống." });

    const dept = await Department.create({ companyId: req.user!.companyId, name, description, managerId, color });
    res.status(201).json({ success: true, data: dept });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PATCH /api/departments/:id — cập nhật phòng ban
router.patch("/:id", authenticate, requireRole("admin"), async (req: AuthRequest, res: Response) => {
  try {
    const dept = await Department.findOneAndUpdate(
      { _id: req.params.id, companyId: req.user!.companyId },
      req.body,
      { new: true }
    );
    if (!dept) return res.status(404).json({ success: false, message: "Không tìm thấy phòng ban." });
    res.json({ success: true, data: dept });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE /api/departments/:id — xoá phòng ban
router.delete("/:id", authenticate, requireRole("admin"), async (req: AuthRequest, res: Response) => {
  try {
    await Department.findOneAndDelete({ _id: req.params.id, companyId: req.user!.companyId });
    // Xoá departmentId khỏi các user thuộc phòng ban này
    await User.updateMany({ departmentId: req.params.id }, { $unset: { departmentId: "" } });
    res.json({ success: true, message: "Đã xoá phòng ban." });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
