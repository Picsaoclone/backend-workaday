import { Router, Response } from "express";
import { authenticate, AuthRequest, requireRole } from "../middleware/auth";
import Task from "../models/Task";
import Notification from "../models/Notification";
import User from "../models/User";
import { emitInAppNotification, pushToUser } from "../services/notify";

const router = Router();

const notifyManagers = async (companyId: string, actorId: string, title: string, message: string, link?: string) => {
  const managers = await User.find({ companyId, role: { $in: ["manager", "admin"] }, isActive: true }).select("_id");
  const receiverIds = managers.map((m) => String(m._id)).filter((id) => id !== actorId);
  if (receiverIds.length === 0) return;

  await Notification.insertMany(
    receiverIds.map((userId) => ({
      companyId,
      userId,
      type: "project_update",
      title,
      message,
      link,
    }))
  );
};

router.get("/", authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const filter: any = { companyId: req.user!.companyId };
    if (req.query.assignedTo) filter.assignedTo = req.query.assignedTo;
    if (req.query.projectId) filter.projectId = req.query.projectId;
    if (req.query.status) filter.status = req.query.status;
    const tasks = await Task.find(filter).sort({ createdAt: -1 });
    res.json({ success: true, data: tasks });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post("/", authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const task = await Task.create({ ...req.body, companyId: req.user!.companyId, assignedBy: req.user!.id });
    // Gửi notification cho người được giao
    if (task.assignedTo !== req.user!.id) {
      const notification = await Notification.create({
        companyId: req.user!.companyId,
        userId: task.assignedTo,
        type: "task_assigned",
        title: "Bạn được giao nhiệm vụ mới",
        message: `"${task.title}" đã được giao cho bạn.`,
        link: `/dashboard/tasks/${task._id}`,
      });

      const io = req.app.get("io");
      emitInAppNotification(io, notification);
      await pushToUser(String(task.assignedTo), notification.title, notification.message, {
        kind: "task_assigned",
        taskId: String(task._id),
      });
    }

    await notifyManagers(
      req.user!.companyId,
      req.user!.id,
      "Task mới được tạo",
      `${req.user!.email} vừa tạo task "${task.title}".`,
      `/dashboard/tasks`
    );

    res.status(201).json({ success: true, data: task });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.patch("/:id", authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const prevTask = await Task.findById(req.params.id);
    const task = await Task.findByIdAndUpdate(req.params.id, req.body, { new: true });

    if (task && prevTask) {
      const statusChanged = prevTask.status !== task.status;
      const progressChanged = prevTask.progress !== task.progress;
      const assigneeChanged = prevTask.assignedTo !== task.assignedTo;

      if (assigneeChanged && task.assignedTo !== req.user!.id) {
        const notification = await Notification.create({
          companyId: req.user!.companyId,
          userId: task.assignedTo,
          type: "task_assigned",
          title: "Bạn được giao nhiệm vụ",
          message: `"${task.title}" đã được chuyển cho bạn.`,
          link: `/dashboard/tasks/${task._id}`,
        });
        const io = req.app.get("io");
        emitInAppNotification(io, notification);
        await pushToUser(String(task.assignedTo), notification.title, notification.message, {
          kind: "task_assigned",
          taskId: String(task._id),
        });
      }

      if (statusChanged || progressChanged || assigneeChanged) {
        const statusLabelMap: Record<string, string> = {
          "todo": "Chưa làm",
          "in-progress": "Đang làm",
          "review": "Review",
          "done": "Hoàn thành",
          "cancelled": "Đã huỷ",
        };

        let title = "Cập nhật tiến độ công việc";
        let message = `Task "${task.title}" được cập nhật.`;

        if (assigneeChanged) {
          title = "Task được phân công lại";
          message = `Task "${task.title}" đã được chuyển người phụ trách.`;
        } else if (statusChanged && task.status === "done") {
          title = "Task đã hoàn thành";
          message = `Task "${task.title}" đã được hoàn thành.`;
        } else if (statusChanged && prevTask.status === "done" && task.status !== "done") {
          title = "Task được mở lại";
          message = `Task "${task.title}" đã được mở lại và chuyển về trạng thái ${statusLabelMap[task.status] || task.status}.`;
        } else if (statusChanged) {
          title = "Task đổi trạng thái";
          message = `Task "${task.title}" chuyển từ ${statusLabelMap[prevTask.status] || prevTask.status} sang ${statusLabelMap[task.status] || task.status}.`;
        } else if (progressChanged) {
          title = "Task cập nhật tiến độ";
          message = `Task "${task.title}" cập nhật tiến độ từ ${prevTask.progress}% lên ${task.progress}%.`;
        }

        await notifyManagers(
          req.user!.companyId,
          req.user!.id,
          title,
          message,
          `/dashboard/tasks`
        );
      }
    }

    res.json({ success: true, data: task });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.delete("/:id", authenticate, requireRole("admin", "manager"), async (req: AuthRequest, res: Response) => {
  try {
    await Task.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: "Đã xoá nhiệm vụ." });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
