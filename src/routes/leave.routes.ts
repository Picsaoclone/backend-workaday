import { Router, Response } from "express";
import { authenticate, AuthRequest, requireRole } from "../middleware/auth";
import LeaveRequest from "../models/LeaveRequest";
import Attendance from "../models/Attendance";
import Notification from "../models/Notification";
import User from "../models/User";
import mongoose from "mongoose";

const router = Router();

type LeaveType = "annual" | "sick" | "unpaid" | "other";

const leaveTypeToLabel: Record<LeaveType, string> = {
  annual: "Nghỉ phép năm",
  sick: "Nghỉ ốm",
  unpaid: "Nghỉ không lương",
  other: "Nghỉ việc riêng",
};

const normalizeLeaveType = (value: string | undefined): LeaveType | null => {
  if (!value) return null;

  const normalized = value.toLowerCase().trim();
  if (["annual", "sick", "unpaid", "other"].includes(normalized)) {
    return normalized as LeaveType;
  }

  if (normalized.includes("phép năm")) return "annual";
  if (normalized.includes("ốm")) return "sick";
  if (normalized.includes("không lương")) return "unpaid";
  if (normalized.includes("việc riêng") || normalized.includes("thai sản")) return "other";

  return null;
};

const serializeLeave = (leave: any) => {
  const plain = typeof leave?.toObject === "function" ? leave.toObject() : leave;
  if (!plain) return plain;

  return {
    ...plain,
    leaveType: leaveTypeToLabel[plain.type as LeaveType] || plain.type,
  };
};

const dayStart = (d: Date): Date => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};

const enumerateDays = (from: Date, to: Date): Date[] => {
  const out: Date[] = [];
  let cur = dayStart(from);
  const end = dayStart(to);
  while (cur.getTime() <= end.getTime()) {
    out.push(new Date(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return out;
};

const leaveAttendanceNote = (leaveId: string) => `leave-request:${leaveId}`;

router.post("/", authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const leaveType = normalizeLeaveType(req.body.type || req.body.leaveType);
    if (!leaveType) {
      return res.status(400).json({ success: false, message: "Loại nghỉ phép không hợp lệ." });
    }

    const requester = await User.findById(req.user!.id).select("name email role managerId");
    if (!requester) {
      return res.status(401).json({ success: false, message: "Không tìm thấy người dùng." });
    }

    const assignedToId = String(req.body.assignedTo || "").trim() || (requester.managerId ? String(requester.managerId) : "");
    if (!assignedToId) {
      return res.status(400).json({ success: false, message: "Bạn cần chọn 1 người duyệt (Manager/Admin)." });
    }

    const assignedUser = await User.findById(assignedToId).select("name email role companyId isActive");
    if (!assignedUser) {
      return res.status(400).json({ success: false, message: "Người duyệt không tồn tại." });
    }
    if (String(assignedUser.companyId) !== String(req.user!.companyId)) {
      return res.status(403).json({ success: false, message: "Không có quyền chọn người duyệt ngoài công ty." });
    }
    if (!assignedUser.isActive) {
      return res.status(400).json({ success: false, message: "Người duyệt hiện không hoạt động." });
    }
    if (assignedUser.role !== "admin" && assignedUser.role !== "manager") {
      return res.status(400).json({ success: false, message: "Người duyệt phải là Manager hoặc Admin." });
    }

    const leave = await LeaveRequest.create({
      companyId: req.user!.companyId,
      userId: req.user!.id,
      assignedTo: String(assignedUser._id),
      type: leaveType,
      startDate: req.body.startDate,
      endDate: req.body.endDate,
      days: req.body.days,
      reason: req.body.reason,
    });

    await Notification.create({
      companyId: req.user!.companyId,
      userId: String(assignedUser._id),
      type: "report_submitted",
      title: "Yêu cầu nghỉ phép mới",
      message: `${requester.name} vừa gửi đơn xin nghỉ.`,
      link: `/dashboard/leave/${leave._id}`,
    });
    res.status(201).json({ success: true, data: serializeLeave(leave) });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get("/", authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const filter: any = { companyId: req.user!.companyId };
    if (req.user!.role === "employee") filter.userId = req.user!.id;
    if (req.user!.role === "manager") filter.assignedTo = req.user!.id;

    const leaves = await LeaveRequest.find(filter).sort({ createdAt: -1 });
    const isReviewer = req.user!.role === "admin" || req.user!.role === "manager";

    const requesterIds = leaves.map((l: any) => String(l.userId)).filter(Boolean);
    const assignedToIds = leaves.map((l: any) => String(l.assignedTo)).filter(Boolean);
    const reviewedByIds = leaves.map((l: any) => String(l.reviewedBy)).filter(Boolean);

    const allUserIds = Array.from(new Set([...requesterIds, ...assignedToIds, ...reviewedByIds]));
    const validUserIds = allUserIds.filter((id) => mongoose.Types.ObjectId.isValid(id));
    const users = validUserIds.length ? await User.find({ _id: { $in: validUserIds } }).select("name email role") : [];
    const byId = new Map(users.map((u: any) => [String(u._id), u]));

    res.json({
      success: true,
      data: leaves.map((l: any) => {
        const base = serializeLeave(l);
        const requester = byId.get(String(l.userId));
        const assignedTo = byId.get(String(l.assignedTo));
        const reviewedBy = byId.get(String(l.reviewedBy));

        const enriched: any = {
          ...base,
          assignedTo: assignedTo
            ? { _id: String(assignedTo._id), name: assignedTo.name, email: assignedTo.email, role: assignedTo.role }
            : undefined,
          reviewedByUser: reviewedBy
            ? { _id: String(reviewedBy._id), name: reviewedBy.name, email: reviewedBy.email, role: reviewedBy.role }
            : undefined,
        };

        if (isReviewer) {
          enriched.user = requester
            ? { _id: String(requester._id), name: requester.name, email: requester.email, role: requester.role }
            : undefined;
        }

        return enriched;
      }),
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.patch("/:id/review", authenticate, requireRole("admin", "manager"), async (req: AuthRequest, res: Response) => {
  try {
    const { status, reviewNotes } = req.body;

    const existing = await LeaveRequest.findById(req.params.id);
    if (!existing) {
      return res.status(404).json({ success: false, message: "Không tìm thấy đơn nghỉ phép." });
    }
    if (String(existing.companyId) !== String(req.user!.companyId)) {
      return res.status(403).json({ success: false, message: "Không có quyền." });
    }
    if (!existing.assignedTo || String(existing.assignedTo) !== String(req.user!.id)) {
      return res.status(403).json({ success: false, message: "Bạn không phải người được chỉ định duyệt đơn này." });
    }

    const prevStatus = existing.status;
    const leave = await LeaveRequest.findByIdAndUpdate(
      req.params.id,
      { status, reviewedBy: req.user!.id, reviewedAt: new Date(), reviewNotes },
      { new: true }
    );
    if (leave) {
      await Notification.create({
        companyId: req.user!.companyId, userId: leave.userId,
        type: status === "approved" ? "leave_approved" : "leave_rejected",
        title: status === "approved" ? "Đơn nghỉ phép được duyệt" : "Đơn nghỉ phép bị từ chối",
        message: reviewNotes || (status === "approved" ? "Yêu cầu nghỉ phép của bạn đã được duyệt." : "Yêu cầu nghỉ phép của bạn bị từ chối."),
      });
      // Trừ ngày phép nếu approved
      if (status === "approved") {
        await User.findByIdAndUpdate(leave.userId, { $inc: { leaveBalance: -leave.days } });

        // Đồng bộ sang chấm công: các ngày trong đơn approved => status = leave
        const dates = enumerateDays(new Date(leave.startDate), new Date(leave.endDate));
        const note = leaveAttendanceNote(String(leave._id));
        await Promise.all(
          dates.map((d) =>
            Attendance.findOneAndUpdate(
              { userId: String(leave.userId), date: dayStart(d) },
              {
                $set: {
                  companyId: String(leave.companyId),
                  userId: String(leave.userId),
                  date: dayStart(d),
                  status: "leave",
                  notes: note,
                },
                $unset: {
                  clockIn: "",
                  clockOut: "",
                  hoursWorked: "",
                  clockInLocation: "",
                },
              },
              { upsert: true, new: true, setDefaultsOnInsert: true }
            )
          )
        );
      }

      // Nếu trước đó đã approved nhưng giờ chuyển sang trạng thái khác: dọn các attendance auto tạo
      if (prevStatus === "approved" && status !== "approved") {
        const dates = enumerateDays(new Date(existing.startDate), new Date(existing.endDate));
        const note = leaveAttendanceNote(String(existing._id));
        await Promise.all(
          dates.map((d) =>
            Attendance.deleteOne({
              userId: String(existing.userId),
              date: dayStart(d),
              status: "leave",
              notes: note,
            })
          )
        );
      }
    }
    res.json({ success: true, data: serializeLeave(leave) });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
