import { Router, Response } from "express";
import { authenticate, AuthRequest } from "../middleware/auth";
import EmployeeReport from "../models/EmployeeReport";
import Notification from "../models/Notification";
import Project from "../models/Project";
import User from "../models/User";
import mongoose from "mongoose";

const router = Router();

const normalizeId = (value: any): string => String(value || "").trim();

const serializeReport = (r: any, byUser: Map<string, any>, byProject: Map<string, any>) => {
  const plain = typeof r?.toObject === "function" ? r.toObject() : r;
  if (!plain) return plain;

  const assignedToId = normalizeId(plain.assignedTo || plain.managerId);
  const reporter = byUser.get(normalizeId(plain.userId));
  const assigned = byUser.get(assignedToId);
  const reviewer = byUser.get(normalizeId(plain.reviewedBy));
  const project = byProject.get(normalizeId(plain.projectId));

  return {
    ...plain,
    assignedTo: assignedToId || undefined,
    managerId: assignedToId || undefined, // keep legacy field for clients
    user: reporter
      ? { _id: normalizeId(reporter._id), name: reporter.name, email: reporter.email, role: reporter.role }
      : undefined,
    assignedToUser: assigned
      ? { _id: normalizeId(assigned._id), name: assigned.name, email: assigned.email, role: assigned.role }
      : undefined,
    reviewedByUser: reviewer
      ? { _id: normalizeId(reviewer._id), name: reviewer.name, email: reviewer.email, role: reviewer.role }
      : undefined,
    project: project ? { _id: normalizeId(project._id), name: project.name } : undefined,
  };
};

const validateAssignee = async (req: AuthRequest, assignedToId: string) => {
  const assignedUser = await User.findById(assignedToId).select("name email role companyId isActive");
  if (!assignedUser) {
    return { ok: false as const, message: "Người nhận báo cáo không tồn tại." };
  }
  if (String(assignedUser.companyId) !== String(req.user!.companyId)) {
    return { ok: false as const, message: "Không có quyền gửi báo cáo ra ngoài công ty." };
  }
  if (!assignedUser.isActive) {
    return { ok: false as const, message: "Người nhận hiện không hoạt động." };
  }
  if (assignedUser.role !== "admin" && assignedUser.role !== "manager") {
    return { ok: false as const, message: "Người nhận phải là Manager hoặc Admin." };
  }
  return { ok: true as const, user: assignedUser };
};

router.post("/", authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const assignedToId = normalizeId(req.body.assignedTo || req.body.managerId);
    const status = normalizeId(req.body.status) || "submitted";

    if (status !== "draft") {
      if (!assignedToId) {
        return res.status(400).json({ success: false, message: "Bạn cần chọn người nhận (Manager/Admin)." });
      }
      const checked = await validateAssignee(req, assignedToId);
      if (!checked.ok) return res.status(400).json({ success: false, message: checked.message });
    }

    const title = normalizeId(req.body.title);
    if (!title) {
      return res.status(400).json({ success: false, message: "Tiêu đề báo cáo là bắt buộc." });
    }
    const content = normalizeId(req.body.content);
    if (!content) {
      return res.status(400).json({ success: false, message: "Nội dung báo cáo là bắt buộc." });
    }

    const report = await EmployeeReport.create({
      companyId: req.user!.companyId,
      userId: req.user!.id,
      title,
      assignedTo: assignedToId || undefined,
      managerId: assignedToId || undefined,
      projectId: normalizeId(req.body.projectId) || undefined,
      date: req.body.date || new Date(),
      type: req.body.type || "weekly",
      content,
      tasksCompleted: Array.isArray(req.body.tasksCompleted) ? req.body.tasksCompleted : [],
      attachments: Array.isArray(req.body.attachments) ? req.body.attachments : [],
      status: status === "draft" ? "draft" : "submitted",
    });

    if (report.status === "submitted" && assignedToId) {
      const user = await User.findById(req.user!.id).select("name");
      await Notification.create({
        companyId: req.user!.companyId,
        userId: assignedToId,
        type: "report_submitted",
        title: "Báo cáo mới từ nhân viên",
        message: `${user?.name || "Nhân viên"} vừa gửi báo cáo.`,
        link: `/dashboard/reports/${report._id}`,
      });
    }

    const users = await User.find({ _id: { $in: [report.userId, assignedToId].filter(Boolean) } }).select("name email role");
    const byUser = new Map(users.map((u: any) => [normalizeId(u._id), u]));
    const projects = report.projectId ? await Project.find({ _id: { $in: [report.projectId] } }).select("name") : [];
    const byProject = new Map(projects.map((p: any) => [normalizeId(p._id), p]));
    res.status(201).json({ success: true, data: serializeReport(report, byUser, byProject) });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get("/", authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const filter: any = { companyId: req.user!.companyId };

    if (req.user!.role === "employee") {
      filter.userId = req.user!.id;
    } else if (req.user!.role === "manager") {
      filter.$or = [{ assignedTo: req.user!.id }, { managerId: req.user!.id }];
    }
    if (req.query.userId) filter.userId = String(req.query.userId);

    const reports = await EmployeeReport.find(filter).sort({ createdAt: -1 });

    const reporterIds = reports.map((r: any) => normalizeId(r.userId)).filter(Boolean);
    const assignedIds = reports.map((r: any) => normalizeId(r.assignedTo || r.managerId)).filter(Boolean);
    const reviewedByIds = reports.map((r: any) => normalizeId(r.reviewedBy)).filter(Boolean);
    const projectIds = reports.map((r: any) => normalizeId(r.projectId)).filter(Boolean);

    const userIds = Array.from(new Set([...reporterIds, ...assignedIds, ...reviewedByIds]));
    const validUserIds = userIds.filter((id) => mongoose.Types.ObjectId.isValid(id));
    const users = validUserIds.length ? await User.find({ _id: { $in: validUserIds } }).select("name email role") : [];
    const byUser = new Map(users.map((u: any) => [normalizeId(u._id), u]));

    const uniqProjectIds = Array.from(new Set(projectIds));
    const validProjectIds = uniqProjectIds.filter((id) => mongoose.Types.ObjectId.isValid(id));
    const projects = validProjectIds.length ? await Project.find({ _id: { $in: validProjectIds } }).select("name") : [];
    const byProject = new Map(projects.map((p: any) => [normalizeId(p._id), p]));

    res.json({ success: true, data: reports.map((r: any) => serializeReport(r, byUser, byProject)) });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PATCH /api/reports/:id - nhân viên cập nhật báo cáo nháp
router.patch("/:id", authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const report = await EmployeeReport.findOne({ _id: req.params.id, userId: req.user!.id });
    if (!report) return res.status(404).json({ success: false, message: "Không tìm thấy báo cáo." });
    if (report.status !== "draft" && report.status !== "changes_requested") {
      return res.status(400).json({ success: false, message: "Báo cáo hiện không thể chỉnh sửa." });
    }

    const nextStatus = normalizeId(req.body.status) || report.status;
    const assignedToId = normalizeId(req.body.assignedTo || req.body.managerId || report.assignedTo || report.managerId);
    if (nextStatus !== "draft") {
      if (!assignedToId) {
        return res.status(400).json({ success: false, message: "Bạn cần chọn người nhận (Manager/Admin)." });
      }
      const checked = await validateAssignee(req, assignedToId);
      if (!checked.ok) return res.status(400).json({ success: false, message: checked.message });
    }

    const updated = await EmployeeReport.findByIdAndUpdate(
      req.params.id,
      {
        title: normalizeId(req.body.title) || report.title,
        content: normalizeId(req.body.content) || report.content,
        projectId: normalizeId(req.body.projectId) || undefined,
        assignedTo: assignedToId || undefined,
        managerId: assignedToId || undefined,
        attachments: Array.isArray(req.body.attachments) ? req.body.attachments : report.attachments,
        status: nextStatus === "draft" ? "draft" : "submitted",
      },
      { new: true }
    );

    if (updated?.status === "submitted" && assignedToId) {
      const user = await User.findById(req.user!.id).select("name");
      await Notification.create({
        companyId: req.user!.companyId,
        userId: assignedToId,
        type: "report_submitted",
        title: "Báo cáo được gửi lại",
        message: `${user?.name || "Nhân viên"} vừa gửi lại báo cáo.`,
        link: `/dashboard/reports/${updated._id}`,
      });
    }

    res.json({ success: true, data: updated });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PATCH /api/reports/:id/viewed - manager/admin mở xem -> chuyển submitted -> viewed
router.patch("/:id/viewed", authenticate, async (req: AuthRequest, res: Response) => {
  try {
    if (req.user!.role !== "admin" && req.user!.role !== "manager") {
      return res.status(403).json({ success: false, message: "Không có quyền." });
    }

    const report = await EmployeeReport.findById(req.params.id);
    if (!report) return res.status(404).json({ success: false, message: "Không tìm thấy báo cáo." });
    if (String(report.companyId) !== String(req.user!.companyId)) {
      return res.status(403).json({ success: false, message: "Không có quyền." });
    }

    const assignedToId = normalizeId(report.assignedTo || report.managerId);
    if (req.user!.role === "manager" && assignedToId !== normalizeId(req.user!.id)) {
      return res.status(403).json({ success: false, message: "Bạn không phải người nhận báo cáo này." });
    }

    if (report.status === "submitted") {
      report.status = "viewed" as any;
      report.viewedAt = new Date();
      await report.save();
    }
    res.json({ success: true, data: report });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PATCH /api/reports/:id/review - approve hoặc yêu cầu chỉnh sửa
router.patch("/:id/review", authenticate, async (req: AuthRequest, res: Response) => {
  try {
    if (req.user!.role !== "admin" && req.user!.role !== "manager") {
      return res.status(403).json({ success: false, message: "Không có quyền." });
    }

    const report = await EmployeeReport.findById(req.params.id);
    if (!report) return res.status(404).json({ success: false, message: "Không tìm thấy báo cáo." });
    if (String(report.companyId) !== String(req.user!.companyId)) {
      return res.status(403).json({ success: false, message: "Không có quyền." });
    }

    const assignedToId = normalizeId(report.assignedTo || report.managerId);
    if (req.user!.role === "manager" && assignedToId !== normalizeId(req.user!.id)) {
      return res.status(403).json({ success: false, message: "Bạn không phải người nhận báo cáo này." });
    }

    const nextStatus = normalizeId(req.body.status);
    const feedback = normalizeId(req.body.feedback);
    if (nextStatus !== "approved" && nextStatus !== "changes_requested") {
      return res.status(400).json({ success: false, message: "Trạng thái review không hợp lệ." });
    }
    if (nextStatus === "changes_requested" && !feedback) {
      return res.status(400).json({ success: false, message: "Vui lòng nhập phản hồi khi yêu cầu chỉnh sửa." });
    }

    report.status = nextStatus as any;
    report.feedback = feedback || undefined;
    report.reviewedBy = normalizeId(req.user!.id);
    report.reviewedAt = new Date();
    await report.save();

    await Notification.create({
      companyId: req.user!.companyId,
      userId: normalizeId(report.userId),
      type: "report_submitted",
      title: nextStatus === "approved" ? "Báo cáo đã được duyệt" : "Báo cáo cần chỉnh sửa",
      message: feedback || (nextStatus === "approved" ? "Báo cáo của bạn đã được duyệt." : "Báo cáo của bạn cần chỉnh sửa."),
      link: `/dashboard/reports/${report._id}`,
    });

    res.json({ success: true, data: report });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
