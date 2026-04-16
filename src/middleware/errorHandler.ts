import { Request, Response, NextFunction } from "express";

export const errorHandler = (
  err: Error & { statusCode?: number },
  _req: Request,
  res: Response,
  _next: NextFunction
): void => {
  const statusCode = err.statusCode || 500;
  const message = err.message || "Đã xảy ra lỗi server. Vui lòng thử lại sau.";

  if (process.env.NODE_ENV === "development") {
    console.error("🔴 Lỗi:", err.stack);
  }

  res.status(statusCode).json({
    success: false,
    message,
    ...(process.env.NODE_ENV === "development" && { stack: err.stack }),
  });
};

export class AppError extends Error {
  statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
  }
}
