import { Router, Response } from "express";
import { authenticate, AuthRequest } from "../middleware/auth";
import Attendance from "../models/Attendance";
import Company from "../models/Company";
import LeaveRequest from "../models/LeaveRequest";
import User from "../models/User";

const router = Router();

const isISODate = (value: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(String(value || "").trim());

const dayStart = (d: Date): Date => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};

const parseHHmmToMinutes = (hhmm: string, fallbackMinutes: number): number => {
  const v = String(hhmm || "").trim();
  const m = v.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!m) return fallbackMinutes;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  return hh * 60 + mm;
};

const formatHHmm = (minutes: number): string => {
  const m = Math.max(0, Math.min(23 * 60 + 59, Math.floor(minutes)));
  const hh = String(Math.floor(m / 60)).padStart(2, "0");
  const mm = String(m % 60).padStart(2, "0");
  return `${hh}:${mm}`;
};

const minutesOfDay = (d: Date): number => d.getHours() * 60 + d.getMinutes();

type DayStatus = "present" | "late" | "absent" | "leave";
type DayRecord = {
  date: string; // YYYY-MM-DD
  clockIn?: Date;
  clockOut?: Date;
  hoursWorked?: number;
  status: DayStatus;
};

const toISODate = (d: Date): string => {
  const x = dayStart(d);
  const yyyy = x.getFullYear();
  const mm = String(x.getMonth() + 1).padStart(2, "0");
  const dd = String(x.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
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

const isOnLeave = (leave: any, date: Date): boolean => {
  const d = dayStart(date).getTime();
  const s = dayStart(new Date(leave.startDate)).getTime();
  const e = dayStart(new Date(leave.endDate)).getTime();
  return d >= s && d <= e;
};

const computeStats = (days: DayRecord[]) => {
  const presentDays = days.filter((d) => d.status === "present").length;
  const lateDays = days.filter((d) => d.status === "late").length;
  const leaveDays = days.filter((d) => d.status === "leave").length;
  const absentDays = days.filter((d) => d.status === "absent").length;

  const workedDays = presentDays + lateDays;
  const totalHours = days.reduce((sum, d) => sum + (typeof d.hoursWorked === "number" ? d.hoursWorked : 0), 0);
  const avgHoursPerDay = workedDays > 0 ? totalHours / workedDays : 0;

  return {
    workedDays,
    totalHours: Number(totalHours.toFixed(2)),
    avgHoursPerDay: Number(avgHoursPerDay.toFixed(2)),
    presentDays,
    lateDays,
    leaveDays,
    absentDays,
  };
};

const computeStatsFromUserStats = (items: ReturnType<typeof computeStats>[]) => {
  const totals = items.reduce(
    (acc, s) => {
      acc.workedDays += s.workedDays;
      acc.totalHours += s.totalHours;
      acc.presentDays += s.presentDays;
      acc.lateDays += s.lateDays;
      acc.leaveDays += s.leaveDays;
      acc.absentDays += s.absentDays;
      return acc;
    },
    {
      workedDays: 0,
      totalHours: 0,
      presentDays: 0,
      lateDays: 0,
      leaveDays: 0,
      absentDays: 0,
    }
  );
  const avgHoursPerDay = totals.workedDays > 0 ? totals.totalHours / totals.workedDays : 0;
  return {
    workedDays: totals.workedDays,
    totalHours: Number(totals.totalHours.toFixed(2)),
    avgHoursPerDay: Number(avgHoursPerDay.toFixed(2)),
    presentDays: totals.presentDays,
    lateDays: totals.lateDays,
    leaveDays: totals.leaveDays,
    absentDays: totals.absentDays,
  };
};

// Clock in
router.post("/clock-in", authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const today = dayStart(new Date());

    const onLeave = await LeaveRequest.exists({
      companyId: req.user!.companyId,
      userId: req.user!.id,
      status: "approved",
      startDate: { $lte: today },
      endDate: { $gte: today },
    });
    if (onLeave) {
      return res.status(400).json({ success: false, message: "Hôm nay bạn đang nghỉ phép đã được duyệt, không thể chấm công." });
    }

    const existing = await Attendance.findOne({ userId: req.user!.id, date: today });
    if (existing?.clockIn) return res.status(400).json({ success: false, message: "Bạn đã chấm công vào ca hôm nay." });

    const company = await Company.findById(req.user!.companyId).select("settings.workingHours");
    const startMinutes = parseHHmmToMinutes(company?.settings?.workingHours?.start || "", 8 * 60);
    const now = new Date();
    const status: DayStatus = minutesOfDay(now) > startMinutes ? "late" : "present";

    const attendance = await Attendance.findOneAndUpdate(
      { userId: req.user!.id, companyId: req.user!.companyId, date: today },
      { clockIn: now, status, clockInLocation: req.body.location },
      { upsert: true, new: true }
    );
    res.json({ success: true, data: attendance });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Clock out
router.post("/clock-out", authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const today = dayStart(new Date());

    const onLeave = await LeaveRequest.exists({
      companyId: req.user!.companyId,
      userId: req.user!.id,
      status: "approved",
      startDate: { $lte: today },
      endDate: { $gte: today },
    });
    if (onLeave) {
      return res.status(400).json({ success: false, message: "Hôm nay bạn đang nghỉ phép đã được duyệt, không thể chấm công." });
    }

    const attendance = await Attendance.findOne({ userId: req.user!.id, date: today });
    if (!attendance?.clockIn) return res.status(400).json({ success: false, message: "Bạn chưa chấm công vào ca." });

    const clockOut = new Date();
    const hoursWorked = (clockOut.getTime() - attendance.clockIn!.getTime()) / 3600000;

    await attendance.updateOne({ clockOut, hoursWorked: parseFloat(hoursWorked.toFixed(2)) });
    res.json({ success: true, data: { ...attendance.toObject(), clockOut, hoursWorked } });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/attendance/my/range?from=YYYY-MM-DD&to=YYYY-MM-DD - lịch sử + stats (employee/manager/admin dùng cho chính mình)
router.get("/my/range", authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const fromStr = String(req.query.from || "");
    const toStr = String(req.query.to || "");
    if (!isISODate(fromStr) || !isISODate(toStr)) {
      return res.status(400).json({ success: false, message: "from/to không hợp lệ (YYYY-MM-DD)." });
    }

    const from = dayStart(new Date(fromStr));
    const to = dayStart(new Date(toStr));
    if (to.getTime() < from.getTime()) {
      return res.status(400).json({ success: false, message: "Khoảng thời gian không hợp lệ." });
    }

    const company = await Company.findById(req.user!.companyId).select("settings.workingHours settings.timezone");
    const startHHmm = company?.settings?.workingHours?.start || "08:00";
    const endHHmm = company?.settings?.workingHours?.end || "17:30";

    const records = await Attendance.find({
      companyId: req.user!.companyId,
      userId: req.user!.id,
      date: { $gte: from, $lte: to },
    }).sort({ date: 1 });

    const leaves = await LeaveRequest.find({
      companyId: req.user!.companyId,
      userId: req.user!.id,
      status: "approved",
      startDate: { $lte: to },
      endDate: { $gte: from },
    }).select("startDate endDate");

    const byISO = new Map(records.map((r: any) => [toISODate(r.date), r]));
    const days: DayRecord[] = enumerateDays(from, to).map((d) => {
      const iso = toISODate(d);
      const r: any = byISO.get(iso);
      const leave = leaves.find((l: any) => isOnLeave(l, d));
      if (leave) {
        return { date: iso, status: "leave" };
      }
      if (!r) return { date: iso, status: "absent" };
      const status: DayStatus = r.status === "late" ? "late" : r.status === "present" ? "present" : (r.status as any) || "absent";
      return {
        date: iso,
        clockIn: r.clockIn,
        clockOut: r.clockOut,
        hoursWorked: r.hoursWorked,
        status,
      };
    });

    res.json({
      success: true,
      data: {
        workingHours: { start: startHHmm, end: endHHmm },
        range: { from: fromStr, to: toStr },
        days,
        stats: computeStats(days),
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/attendance/company/day?date=YYYY-MM-DD - admin theo dõi chấm công theo ngày
router.get("/company/day", authenticate, async (req: AuthRequest, res: Response) => {
  try {
    if (req.user!.role !== "admin" && req.user!.role !== "manager") {
      return res.status(403).json({ success: false, message: "Chỉ admin/manager mới có quyền theo dõi chấm công." });
    }

    const dateStr = String(req.query.date || "");
    if (!isISODate(dateStr)) {
      return res.status(400).json({ success: false, message: "date không hợp lệ (YYYY-MM-DD)." });
    }
    const d = dayStart(new Date(dateStr));

    const company = await Company.findById(req.user!.companyId).select("settings.workingHours");
    const startHHmm = company?.settings?.workingHours?.start || "08:00";
    const endHHmm = company?.settings?.workingHours?.end || "17:30";
    const startMinutes = parseHHmmToMinutes(startHHmm, 8 * 60);

    const employees = await User.find({ companyId: req.user!.companyId, isActive: true }).select("name email role");

    const records = await Attendance.find({ companyId: req.user!.companyId, date: d });
    const byUser = new Map(records.map((r: any) => [String(r.userId), r]));

    const leaves = await LeaveRequest.find({
      companyId: req.user!.companyId,
      status: "approved",
      startDate: { $lte: d },
      endDate: { $gte: d },
    }).select("userId startDate endDate");
    const leaveUsers = new Set(leaves.map((l: any) => String(l.userId)));

    const rows = employees
      .filter((u: any) => u.role === "employee")
      .map((u: any) => {
        const r: any = byUser.get(String(u._id));
        if (leaveUsers.has(String(u._id))) {
          return { user: u, day: { date: dateStr, status: "leave" as DayStatus } };
        }
        if (!r || !r.clockIn) {
          return { user: u, day: { date: dateStr, status: "absent" as DayStatus } };
        }
        const status: DayStatus = minutesOfDay(new Date(r.clockIn)) > startMinutes ? "late" : "present";
        return {
          user: u,
          day: { date: dateStr, status, clockIn: r.clockIn, clockOut: r.clockOut, hoursWorked: r.hoursWorked },
        };
      });

    res.json({
      success: true,
      data: {
        workingHours: { start: startHHmm, end: endHHmm },
        date: dateStr,
        rows,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/attendance/company/range?from=YYYY-MM-DD&to=YYYY-MM-DD - admin theo dõi theo tuần/tháng (tổng hợp theo nhân viên)
router.get("/company/range", authenticate, async (req: AuthRequest, res: Response) => {
  try {
    if (req.user!.role !== "admin" && req.user!.role !== "manager") {
      return res.status(403).json({ success: false, message: "Chỉ admin/manager mới có quyền theo dõi chấm công." });
    }

    const fromStr = String(req.query.from || "");
    const toStr = String(req.query.to || "");
    if (!isISODate(fromStr) || !isISODate(toStr)) {
      return res.status(400).json({ success: false, message: "from/to không hợp lệ (YYYY-MM-DD)." });
    }

    const from = dayStart(new Date(fromStr));
    const to = dayStart(new Date(toStr));
    if (to.getTime() < from.getTime()) {
      return res.status(400).json({ success: false, message: "Khoảng thời gian không hợp lệ." });
    }

    const company = await Company.findById(req.user!.companyId).select("settings.workingHours");
    const startHHmm = company?.settings?.workingHours?.start || "08:00";
    const endHHmm = company?.settings?.workingHours?.end || "17:30";

    const employees = await User.find({ companyId: req.user!.companyId, isActive: true })
      .select("name email role")
      .lean();
    const employeeUsers = employees.filter((u: any) => u.role === "employee");

    const records = await Attendance.find({
      companyId: req.user!.companyId,
      date: { $gte: from, $lte: to },
    }).select("userId date clockIn clockOut hoursWorked status");

    const leaves = await LeaveRequest.find({
      companyId: req.user!.companyId,
      status: "approved",
      startDate: { $lte: to },
      endDate: { $gte: from },
    }).select("userId startDate endDate");

    const byUserByISO = new Map<string, Map<string, any>>();
    for (const r of records as any[]) {
      const userId = String(r.userId);
      const iso = toISODate(r.date);
      if (!byUserByISO.has(userId)) byUserByISO.set(userId, new Map());
      byUserByISO.get(userId)!.set(iso, r);
    }

    const leavesByUser = new Map<string, any[]>();
    for (const l of leaves as any[]) {
      const userId = String(l.userId);
      if (!leavesByUser.has(userId)) leavesByUser.set(userId, []);
      leavesByUser.get(userId)!.push(l);
    }

    const dayList = enumerateDays(from, to);
    const rows = employeeUsers.map((u: any) => {
      const userId = String(u._id);
      const recByISO = byUserByISO.get(userId) || new Map<string, any>();
      const userLeaves = leavesByUser.get(userId) || [];

      const days: DayRecord[] = dayList.map((d) => {
        const iso = toISODate(d);
        const leave = userLeaves.find((x: any) => isOnLeave(x, d));
        if (leave) return { date: iso, status: "leave" };
        const r: any = recByISO.get(iso);
        if (!r) return { date: iso, status: "absent" };
        const status: DayStatus = r.status === "late" ? "late" : r.status === "present" ? "present" : (r.status as any) || "absent";
        return {
          date: iso,
          clockIn: r.clockIn,
          clockOut: r.clockOut,
          hoursWorked: r.hoursWorked,
          status,
        };
      });

      const stats = computeStats(days);
      return { user: u, stats };
    });

    const overall = computeStatsFromUserStats(rows.map((r: any) => r.stats));

    res.json({
      success: true,
      data: {
        workingHours: { start: startHHmm, end: endHHmm },
        range: { from: fromStr, to: toStr },
        overall,
        rows,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET records
router.get("/", authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const filter: any = { companyId: req.user!.companyId };
    if (req.query.userId) filter.userId = req.query.userId;
    else if (req.user!.role === "employee") filter.userId = req.user!.id;
    const records = await Attendance.find(filter).sort({ date: -1 }).limit(100);
    res.json({ success: true, data: records });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
