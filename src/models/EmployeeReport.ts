import mongoose, { Schema, Document } from "mongoose";

type ReportStatus = "draft" | "submitted" | "viewed" | "approved" | "changes_requested";

type ReportAttachment = {
  url: string;
  name: string;
  type: string;
  size: number;
  resourceType?: "image" | "file";
};

export interface IEmployeeReport extends Document {
  companyId: string;
  userId: string;
  managerId?: string; // legacy field
  assignedTo?: string;
  projectId?: string;
  title: string;
  date?: Date;
  type: "daily" | "weekly" | "monthly";
  content: string;
  tasksCompleted?: string[];
  attachments?: ReportAttachment[];
  status: ReportStatus;
  feedback?: string;
  reviewedBy?: string;
  reviewedAt?: Date;
  viewedAt?: Date;
}

const EmployeeReportSchema = new Schema<IEmployeeReport>(
  {
    companyId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    managerId: { type: String },
    assignedTo: { type: String, index: true },
    projectId: { type: String, index: true },
    title: { type: String, required: true },
    date: { type: Date, default: () => new Date() },
    type: { type: String, enum: ["daily", "weekly", "monthly"], required: true },
    content: { type: String, required: true },
    tasksCompleted: { type: [String], default: [] },
    attachments: {
      type: [
        {
          url: { type: String, required: true },
          name: { type: String, required: true },
          type: { type: String, required: true },
          size: { type: Number, required: true },
          resourceType: { type: String, enum: ["image", "file"] },
        },
      ],
      default: [],
    },
    status: {
      type: String,
      enum: ["draft", "submitted", "viewed", "approved", "changes_requested"],
      default: "draft",
    },
    feedback: { type: String },
    reviewedBy: { type: String },
    reviewedAt: { type: Date },
    viewedAt: { type: Date },
  },
  { timestamps: true }
);

export default mongoose.model<IEmployeeReport>("EmployeeReport", EmployeeReportSchema);
