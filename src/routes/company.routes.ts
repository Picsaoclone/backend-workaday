import { Router, Response } from "express";
import { authenticate, AuthRequest, requireRole } from "../middleware/auth";
import Company from "../models/Company";
import User from "../models/User";
import Channel from "../models/Channel";
import { AppError } from "../middleware/errorHandler";

const router = Router();

const ALLOWED_ROLE_COLOR_TOKENS = new Set(["primary", "info", "success", "warning", "danger", "purple", "teal"]);

const slugifyKey = (name: string): string => {
  return String(name)
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 40);
};

// Tạo invite code duy nhất
const generateInviteCode = async (companyName: string): Promise<string> => {
  const prefix = companyName.replace(/[^A-Za-z]/g, "").substring(0, 4).toUpperCase().padEnd(4, "X");
  let code: string;
  let exists: boolean;
  do {
    const suffix = Math.random().toString(36).substring(2, 6).toUpperCase();
    code = `${prefix}-${suffix}`;
    exists = !!(await Company.findOne({ $or: [{ inviteCode: code }, { customInviteCode: code }] }));
  } while (exists);
  return code;
};

const ensureProfileChannelForUser = async (companyId: string, userId: string, name: string): Promise<void> => {
  const channelName = `profile-${userId}`;
  const exists = await Channel.findOne({ companyId, name: channelName, type: "private" });
  if (exists) return;

  await Channel.create({
    companyId,
    name: channelName,
    description: `Kênh hồ sơ cá nhân của ${name}`,
    type: "private",
    memberIds: [userId],
    adminIds: [userId],
    createdBy: userId,
  });
};

// POST /api/companies - tạo công ty mới
router.post("/", authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { name, industry, size, address, phone, website, logo } = req.body;
    if (!name || !industry || !size) throw new AppError("Vui lòng điền đầy đủ thông tin công ty.", 400);

    const inviteCode = await generateInviteCode(name);
    const company = await Company.create({
      name, industry, size, address, phone, website, logo,
      inviteCode,
      ownerId: req.user!.id,
    });

    // Cập nhật companyId cho owner
    await User.findByIdAndUpdate(req.user!.id, { companyId: company._id, role: "admin" });

    // Tạo channels mặc định
    await Channel.insertMany([
      { companyId: company._id, name: "general", description: "Kênh chung", type: "public", memberIds: [req.user!.id], adminIds: [req.user!.id], createdBy: req.user!.id },
      { companyId: company._id, name: "announcements", description: "Thông báo công ty", type: "public", memberIds: [req.user!.id], adminIds: [req.user!.id], createdBy: req.user!.id },
    ]);

    const owner = await User.findById(req.user!.id).select("name");
    await ensureProfileChannelForUser(company._id.toString(), req.user!.id, owner?.name || "User");

    res.status(201).json({ success: true, message: "Tạo công ty thành công!", data: company });
  } catch (err: any) {
    res.status(err.statusCode || 500).json({ success: false, message: err.message });
  }
});

// GET /api/companies/my/invite-code - admin/manager lấy mã mời công ty của mình
router.get("/my/invite-code", authenticate, requireRole("admin", "manager"), async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user!.companyId) throw new AppError("Bạn chưa thuộc công ty nào.", 400);
    const company = await Company.findById(req.user!.companyId).select("name inviteCode customInviteCode");
    if (!company) throw new AppError("Không tìm thấy công ty.", 404);
    res.json({
      success: true,
      data: {
        companyId: company._id,
        name: company.name,
        inviteCode: company.inviteCode,
        customInviteCode: (company as any).customInviteCode || undefined,
      },
    });
  } catch (err: any) {
    res.status(err.statusCode || 500).json({ success: false, message: err.message });
  }
});

// PUT /api/companies/my/custom-invite-code - admin set mã giới thiệu tuỳ chỉnh
router.put("/my/custom-invite-code", authenticate, requireRole("admin"), async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user!.companyId) throw new AppError("Bạn chưa thuộc công ty nào.", 400);
    const raw = String(req.body?.code || "").trim().toUpperCase();
    if (!raw) throw new AppError("Vui lòng nhập mã tuỳ chỉnh.", 400);
    if (!/^[A-Z0-9\-]{4,24}$/.test(raw)) {
      throw new AppError("Mã tuỳ chỉnh không hợp lệ (4-24 ký tự, chỉ gồm A-Z, 0-9, '-').", 400);
    }

    const company = await Company.findById(req.user!.companyId);
    if (!company) throw new AppError("Không tìm thấy công ty.", 404);

    if (raw === company.inviteCode) {
      throw new AppError("Mã tuỳ chỉnh không được trùng mã khởi tạo.", 400);
    }

    const exists = await Company.findOne({
      _id: { $ne: company._id },
      $or: [{ inviteCode: raw }, { customInviteCode: raw }],
    }).select("_id");
    if (exists) throw new AppError("Mã này đã được dùng bởi công ty khác.", 400);

    (company as any).customInviteCode = raw;
    await company.save();

    res.json({ success: true, message: "Đã cập nhật mã tuỳ chỉnh.", data: { customInviteCode: (company as any).customInviteCode } });
  } catch (err: any) {
    res.status(err.statusCode || 500).json({ success: false, message: err.message });
  }
});

// GET /api/companies/my/job-roles - lấy danh sách role công việc (company-scoped)
router.get("/my/job-roles", authenticate, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user!.companyId) throw new AppError("Bạn chưa thuộc công ty nào.", 400);
    const company = await Company.findById(req.user!.companyId).select("jobRoles");
    if (!company) throw new AppError("Không tìm thấy công ty.", 404);
    res.json({ success: true, data: company.jobRoles || [] });
  } catch (err: any) {
    res.status(err.statusCode || 500).json({ success: false, message: err.message });
  }
});

// GET /api/companies/my/work-settings - lấy giờ làm việc (start/end)
router.get("/my/work-settings", authenticate, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user!.companyId) throw new AppError("Bạn chưa thuộc công ty nào.", 400);
    const company = await Company.findById(req.user!.companyId).select(
      "settings.workingHours settings.workingDays settings.annualLeave settings.timezone"
    );
    if (!company) throw new AppError("Không tìm thấy công ty.", 404);
    res.json({ success: true, data: company.settings });
  } catch (err: any) {
    res.status(err.statusCode || 500).json({ success: false, message: err.message });
  }
});

const isHHmm = (value: string): boolean => {
  const v = String(value || "").trim();
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
};

// PATCH /api/companies/my/work-settings - admin cập nhật giờ làm việc (start/end)
router.patch("/my/work-settings", authenticate, requireRole("admin"), async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user!.companyId) throw new AppError("Bạn chưa thuộc công ty nào.", 400);
    const { start, end, annualLeave } = req.body || {};

    const patch: any = {};
    if (typeof start !== "undefined") {
      const s = String(start).trim();
      if (!isHHmm(s)) throw new AppError("Giờ bắt đầu không hợp lệ (HH:mm).", 400);
      patch["settings.workingHours.start"] = s;
    }
    if (typeof end !== "undefined") {
      const e = String(end).trim();
      if (!isHHmm(e)) throw new AppError("Giờ kết thúc không hợp lệ (HH:mm).", 400);
      patch["settings.workingHours.end"] = e;
    }

    if (typeof annualLeave !== "undefined") {
      const n = Number(annualLeave);
      if (!Number.isFinite(n) || n < 0 || n > 365) {
        throw new AppError("Số ngày phép năm không hợp lệ.", 400);
      }
      patch["settings.annualLeave"] = n;
    }

    if (Object.keys(patch).length === 0) throw new AppError("Không có dữ liệu cập nhật.", 400);

    const company = await Company.findByIdAndUpdate(req.user!.companyId, { $set: patch }, { new: true }).select(
      "settings.workingHours settings.workingDays settings.annualLeave settings.timezone"
    );
    if (!company) throw new AppError("Không tìm thấy công ty.", 404);

    res.json({ success: true, message: "Đã cập nhật giờ làm việc.", data: company.settings });
  } catch (err: any) {
    res.status(err.statusCode || 500).json({ success: false, message: err.message });
  }
});

// POST /api/companies/my/job-roles - admin tạo role công việc mới + chọn màu
router.post("/my/job-roles", authenticate, requireRole("admin"), async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user!.companyId) throw new AppError("Bạn chưa thuộc công ty nào.", 400);
    const { name, colorToken } = req.body;

    const trimmedName = String(name || "").trim();
    const trimmedColorToken = String(colorToken || "").trim();

    if (!trimmedName) throw new AppError("Vui lòng nhập tên role.", 400);
    if (!ALLOWED_ROLE_COLOR_TOKENS.has(trimmedColorToken)) {
      throw new AppError("Màu role không hợp lệ.", 400);
    }

    const company = await Company.findById(req.user!.companyId);
    if (!company) throw new AppError("Không tìm thấy công ty.", 404);

    const existing = company.jobRoles || [];
    const baseKey = slugifyKey(trimmedName) || "role";
    let key = baseKey;
    let suffix = 2;
    while (existing.some((r: any) => r.key === key)) {
      key = `${baseKey}-${suffix}`;
      suffix += 1;
    }

    const next = { key, name: trimmedName, colorToken: trimmedColorToken };
    company.jobRoles = [...existing, next] as any;
    await company.save();

    res.status(201).json({ success: true, message: "Đã tạo role mới.", data: next });
  } catch (err: any) {
    res.status(err.statusCode || 500).json({ success: false, message: err.message });
  }
});

// POST /api/companies/my/refresh-invite-code - admin làm mới mã mời công ty
router.post("/my/refresh-invite-code", authenticate, requireRole("admin"), async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user!.companyId) throw new AppError("Bạn chưa thuộc công ty nào.", 400);
    const company = await Company.findById(req.user!.companyId);
    if (!company) throw new AppError("Không tìm thấy công ty.", 404);

    // Keep initial inviteCode immutable; refresh generates a new auto custom invite code.
    (company as any).customInviteCode = await generateInviteCode(company.name);
    await company.save();

    res.json({
      success: true,
      message: "Đã tạo mã tuỳ chỉnh mới.",
      data: { customInviteCode: (company as any).customInviteCode },
    });
  } catch (err: any) {
    res.status(err.statusCode || 500).json({ success: false, message: err.message });
  }
});

// GET /api/companies/:id
router.get("/:id", authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const company = await Company.findById(req.params.id);
    if (!company) throw new AppError("Không tìm thấy công ty.", 404);
    res.json({ success: true, data: company });
  } catch (err: any) {
    res.status(err.statusCode || 500).json({ success: false, message: err.message });
  }
});

// GET /api/companies/invite/:code - kiểm tra mã mời
router.get("/invite/:code", async (req: any, res: Response) => {
  try {
    const code = String(req.params.code || "").toUpperCase();
    const company = await Company.findOne({ $or: [{ inviteCode: code }, { customInviteCode: code }] }).select(
      "name logo industry"
    );
    if (!company) throw new AppError("Mã mời không hợp lệ.", 404);
    res.json({ success: true, data: company });
  } catch (err: any) {
    res.status(err.statusCode || 500).json({ success: false, message: err.message });
  }
});

export default router;
