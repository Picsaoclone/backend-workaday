import mongoose, { Schema, Document } from "mongoose";

export interface INotification extends Document {
  companyId: string;
  userId: string;
  type:
    | "task_assigned"
    | "meeting_invite"
    | "meeting_reminder"
    | "leave_approved"
    | "leave_rejected"
    | "report_submitted"
    | "message"
    | "mention"
    | "project_update"
    | "system";
  title: string;
  message: string;
  link?: string;
  isRead: boolean;
  readAt?: Date;
}

const NotificationSchema = new Schema<INotification>(
  {
    companyId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    type: {
      type: String,
      enum: [
        "task_assigned",
        "meeting_invite",
        "meeting_reminder",
        "leave_approved",
        "leave_rejected",
        "report_submitted",
        "message",
        "mention",
        "project_update",
        "system",
      ],
      required: true,
    },
    title: { type: String, required: true },
    message: { type: String, required: true },
    link: { type: String },
    isRead: { type: Boolean, default: false },
    readAt: { type: Date },
  },
  { timestamps: true }
);

export default mongoose.model<INotification>("Notification", NotificationSchema);
