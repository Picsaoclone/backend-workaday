import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import User from "../models/User";

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    role: string;
    companyId: string;
  };
}

export const authenticate = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      res.status(401).json({ success: false, message: "Chưa đăng nhập. Vui lòng đăng nhập lại." });
      return;
    }

    const token = authHeader.split(" ")[1];
    const secret = process.env.JWT_SECRET || "workaday_secret_key";

    const decoded = jwt.verify(token, secret) as { id: string; email: string; role: string; companyId: string };

    const user = await User.findById(decoded.id).select("-password");
    if (!user || !user.isActive) {
      res.status(401).json({ success: false, message: "Tài khoản không tồn tại hoặc đã bị vô hiệu hoá." });
      return;
    }

    // Always trust the DB for current role/company, so permission changes apply immediately.
    req.user = {
      id: user._id.toString(),
      email: user.email,
      role: user.role,
      companyId: user.companyId || "",
    };
    next();
  } catch {
    res.status(401).json({ success: false, message: "Token không hợp lệ hoặc đã hết hạn." });
  }
};

export const requireRole = (...roles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({ success: false, message: "Bạn không có quyền thực hiện thao tác này." });
      return;
    }
    next();
  };
};
