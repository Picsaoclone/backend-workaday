import { Router, Response } from "express";
import { authenticate, AuthRequest, requireRole } from "../middleware/auth";
import Project from "../models/Project";
import Notification from "../models/Notification";
import User from "../models/User";
import { emitInAppNotification, pushToUser } from "../services/notify";

const router = Router();

router.get("/", authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const projects = await Project.find({ companyId: req.user!.companyId }).sort({ createdAt: -1 });
    res.json({ success: true, data: projects });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post("/", authenticate, requireRole("admin", "manager"), async (req: AuthRequest, res: Response) => {
  try {
    const project = await Project.create({ ...req.body, companyId: req.user!.companyId, createdBy: req.user!.id });
    res.status(201).json({ success: true, data: project });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get("/:id", authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const project = await Project.findOne({ _id: req.params.id, companyId: req.user!.companyId });
    if (!project) return res.status(404).json({ success: false, message: "Không tìm thấy dự án." });
    res.json({ success: true, data: project });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.patch("/:id", authenticate, requireRole("admin", "manager"), async (req: AuthRequest, res: Response) => {
  try {
    const prevProject = await Project.findById(req.params.id);
    const project = await Project.findByIdAndUpdate(req.params.id, req.body, { new: true });

    if (project) {
      if (prevProject) {
        const prevTeam = Array.isArray(prevProject.teamIds) ? prevProject.teamIds : [];
        const nextTeam = Array.isArray(project.teamIds) ? project.teamIds : [];
        const addedMemberIds = nextTeam
          .filter((id) => !prevTeam.includes(id))
          .map((id) => String(id))
          .filter((id) => id !== String(req.user!.id));

        const io = req.app.get("io");
        for (const userId of addedMemberIds) {
          const notification = await Notification.create({
            companyId: req.user!.companyId,
            userId,
            type: "project_update",
            title: "Bạn được thêm vào dự án",
            message: `Bạn đã được thêm vào dự án "${project.name}".`,
            link: `/dashboard/projects/${project._id}`,
          });
          emitInAppNotification(io, notification);
          await pushToUser(userId, notification.title, notification.message, {
            kind: "project_added",
            projectId: String(project._id),
          });
        }
      }

      const managers = await User.find({ companyId: req.user!.companyId, role: { $in: ["manager", "admin"] }, isActive: true }).select("_id");
      const receiverIds = managers.map((m) => String(m._id)).filter((id) => id !== req.user!.id);

      if (receiverIds.length > 0) {
        await Notification.insertMany(
          receiverIds.map((userId) => ({
            companyId: req.user!.companyId,
            userId,
            type: "project_update",
            title: "Dự án được cập nhật",
            message: `Dự án "${project.name}" vừa được cập nhật trạng thái/tiến độ/thành viên.`,
            link: `/dashboard/projects/${project._id}`,
          }))
        );
      }
    }

    res.json({ success: true, data: project });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.delete("/:id", authenticate, requireRole("admin", "manager"), async (req: AuthRequest, res: Response) => {
  try {
    await Project.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: "Đã xoá dự án." });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
