import { Router, Response } from "express";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import nodemailer from "nodemailer";
import { body, validationResult } from "express-validator";
import User from "../models/User";
import Company from "../models/Company";
import Channel from "../models/Channel";
import Invitation from "../models/Invitation";
import { AppError } from "../middleware/errorHandler";

const router = Router();

const generateToken = (user: { id: string; email: string; role: string; companyId: string }) => {
  return jwt.sign(user, process.env.JWT_SECRET || "workaday_secret_key", {
    expiresIn: process.env.JWT_EXPIRES_IN || "7d",
  } as jwt.SignOptions);
};

const sendResetPasswordEmail = async (toEmail: string, resetUrl: string): Promise<void> => {
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;

  if (!smtpUser || !smtpPass || smtpUser.includes("your_email") || smtpPass.includes("your_app_password")) {
    console.warn("⚠️ SMTP chưa cấu hình đầy đủ, bỏ qua gửi email reset password.");
    return;
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT || 587) === 465,
    auth: {
      user: smtpUser,
      pass: smtpPass,
    },
  });

  await transporter.sendMail({
    from: process.env.EMAIL_FROM || "Workaday <noreply@workaday.vn>",
    to: toEmail,
    subject: "[Workaday] Yêu cầu đặt lại mật khẩu",
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #1f2937;">
        <h2>Đặt lại mật khẩu Workaday</h2>
        <p>Bạn vừa yêu cầu đặt lại mật khẩu cho tài khoản Workaday.</p>
        <p>Nhấn vào nút bên dưới để đặt lại mật khẩu (hiệu lực trong 15 phút):</p>
        <p>
          <a href="${resetUrl}" style="display:inline-block;padding:10px 16px;background:#0ea5e9;color:#fff;text-decoration:none;border-radius:8px;">Đặt lại mật khẩu</a>
        </p>
        <p>Nếu bạn không yêu cầu thao tác này, có thể bỏ qua email.</p>
      </div>
    `,
  });
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

const joinDefaultPublicChannels = async (companyId: string, userId: string): Promise<void> => {
  await Channel.updateMany({ companyId, type: "public" }, { $addToSet: { memberIds: userId } });
};

// POST /api/auth/register
router.post(
  "/register",
  [
    body("email").isEmail().withMessage("Email không hợp lệ"),
    body("password").isLength({ min: 8 }).withMessage("Mật khẩu tối thiểu 8 ký tự"),
    body("name").notEmpty().withMessage("Họ tên không được để trống"),
  ],
  async (req: any, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    try {
      const { email, password, name, phone, inviteCode } = req.body;

      const exists = await User.findOne({ email });
      if (exists) throw new AppError("Email này đã được đăng ký.", 400);

      let companyId: string | undefined;
      let role: "admin" | "manager" | "employee" = "admin";
      let usedInvitation: any = null;

      if (inviteCode) {
        const normalizedCode = String(inviteCode).toUpperCase().trim();

        const invitation = await Invitation.findOne({
          code: normalizedCode,
          used: false,
          expiresAt: { $gt: new Date() },
        });

        if (invitation) {
          if (invitation.email !== email.toLowerCase()) {
            throw new AppError("Mã mời này chỉ áp dụng cho email được chỉ định.", 400);
          }
          companyId = invitation.companyId;
          role = invitation.role;
          usedInvitation = invitation;
        } else {
          const company = await Company.findOne({
            $or: [{ inviteCode: normalizedCode }, { customInviteCode: normalizedCode }],
          });
          if (!company) throw new AppError("Mã mời không hợp lệ.", 400);
          companyId = company._id.toString();
          role = "employee";
        }
      }

      const user = await User.create({ email, password, name, phone, companyId, role });

      if (companyId) {
        await joinDefaultPublicChannels(companyId, user._id.toString());
        await ensureProfileChannelForUser(companyId, user._id.toString(), user.name);
      }

      if (usedInvitation) {
        usedInvitation.used = true;
        usedInvitation.usedAt = new Date();
        usedInvitation.usedBy = user._id.toString();
        await usedInvitation.save();
      }

      const token = generateToken({
        id: user._id.toString(),
        email: user.email,
        role: user.role,
        companyId: companyId || "",
      });

      res.status(201).json({
        success: true,
        message: "Đăng ký thành công!",
        data: { user, token },
      });
    } catch (err: any) {
      res.status(err.statusCode || 500).json({ success: false, message: err.message });
    }
  }
);

// POST /api/auth/login
router.post(
  "/login",
  [
    body("email").isEmail().withMessage("Email không hợp lệ"),
    body("password").notEmpty().withMessage("Vui lòng nhập mật khẩu"),
  ],
  async (req: any, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    try {
      const { email, password } = req.body;

      const user = await User.findOne({ email }).select("+password");
      if (!user || !user.isActive) throw new AppError("Email hoặc mật khẩu không đúng.", 401);

      const isMatch = await user.comparePassword(password);
      if (!isMatch) throw new AppError("Email hoặc mật khẩu không đúng.", 401);

      // Cập nhật lastSeen
      user.lastSeen = new Date();
      await user.save();

      const token = generateToken({
        id: user._id.toString(),
        email: user.email,
        role: user.role,
        companyId: user.companyId || "",
      });

      res.json({
        success: true,
        message: "Đăng nhập thành công!",
        data: { user, token },
      });
    } catch (err: any) {
      res.status(err.statusCode || 500).json({ success: false, message: err.message });
    }
  }
);

// POST /api/auth/forgot-password
router.post(
  "/forgot-password",
  [body("email").isEmail().withMessage("Email không hợp lệ")],
  async (req: any, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    try {
      const { email } = req.body;
      const user = await User.findOne({ email: String(email).toLowerCase(), isActive: true }).select("+resetPasswordToken +resetPasswordExpires");

      // Luôn trả về cùng một message để tránh lộ email có tồn tại hay không
      const genericMessage = "Nếu email tồn tại trong hệ thống, chúng tôi đã gửi link đặt lại mật khẩu.";

      if (!user) {
        return res.json({ success: true, message: genericMessage });
      }

      const rawToken = crypto.randomBytes(32).toString("hex");
      const hashedToken = crypto.createHash("sha256").update(rawToken).digest("hex");
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

      user.resetPasswordToken = hashedToken;
      user.resetPasswordExpires = expiresAt;
      await user.save({ validateBeforeSave: false });

      const frontendBase = process.env.FRONTEND_URL || "http://localhost:5173";
      const resetUrl = `${frontendBase}/reset-password?token=${rawToken}`;

      try {
        await sendResetPasswordEmail(user.email, resetUrl);
      } catch (mailErr) {
        console.error("❌ Gửi email reset mật khẩu thất bại:", mailErr);
      }

      res.json({
        success: true,
        message: genericMessage,
        ...(process.env.NODE_ENV === "development" && { debugResetUrl: resetUrl }),
      });
    } catch (err: any) {
      res.status(err.statusCode || 500).json({ success: false, message: err.message });
    }
  }
);

// POST /api/auth/reset-password
router.post(
  "/reset-password",
  [
    body("token").notEmpty().withMessage("Thiếu token đặt lại mật khẩu"),
    body("password").isLength({ min: 8 }).withMessage("Mật khẩu tối thiểu 8 ký tự"),
  ],
  async (req: any, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    try {
      const { token, password } = req.body;
      const hashedToken = crypto.createHash("sha256").update(token).digest("hex");

      const user = await User.findOne({
        resetPasswordToken: hashedToken,
        resetPasswordExpires: { $gt: new Date() },
        isActive: true,
      }).select("+password +resetPasswordToken +resetPasswordExpires");

      if (!user) {
        throw new AppError("Link đặt lại mật khẩu không hợp lệ hoặc đã hết hạn.", 400);
      }

      user.password = password;
      user.resetPasswordToken = undefined;
      user.resetPasswordExpires = undefined;
      await user.save();

      res.json({ success: true, message: "Đặt lại mật khẩu thành công. Vui lòng đăng nhập lại." });
    } catch (err: any) {
      res.status(err.statusCode || 500).json({ success: false, message: err.message });
    }
  }
);

// GET /api/auth/me
router.get("/me", async (req: any, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return res.status(401).json({ success: false, message: "Chưa đăng nhập." });
    }
    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "workaday_secret_key") as any;
    const user = await User.findById(decoded.id);
    if (!user) return res.status(404).json({ success: false, message: "Không tìm thấy người dùng." });
    res.json({ success: true, data: user });
  } catch {
    res.status(401).json({ success: false, message: "Token không hợp lệ." });
  }
});

export default router;
