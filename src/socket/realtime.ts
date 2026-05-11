import { Server } from "socket.io";

export const emitCompanyEvent = (io: Server | undefined, companyId: string | undefined, event: string, payload: any) => {
  if (!io || !companyId) return;
  io.to(`company:${companyId}`).emit(event, payload);
};

export const emitUserEvent = (io: Server | undefined, userId: string | undefined, event: string, payload: any) => {
  if (!io || !userId) return;
  io.to(`user:${userId}`).emit(event, payload);
};

export const emitNotificationEvent = (io: Server | undefined, notification: any) => {
  if (!io || !notification?.userId) return;
  emitUserEvent(io, String(notification.userId), "notification:new", notification);
};
