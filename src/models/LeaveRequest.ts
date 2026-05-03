import mongoose, { Schema, Document } from "mongoose";

export interface ILeaveRequest extends Document {
  companyId: string;
  userId: string;
  assignedTo?: string;
  type: "annual" | "sick" | "unpaid" | "other";
  startDate: Date;
  endDate: Date;
  days: number;
  reason: string;
  status: "pending" | "approved" | "rejected";
  reviewedBy?: string;
  reviewedAt?: Date;
  reviewNotes?: string;
}

const LeaveRequestSchema = new Schema<ILeaveRequest>(
  {
    companyId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    assignedTo: { type: String, index: true },
    type: { type: String, enum: ["annual", "sick", "unpaid", "other"], required: true },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    days: { type: Number, required: true, min: 0.5 },
    reason: { type: String, required: true },
    status: { type: String, enum: ["pending", "approved", "rejected"], default: "pending" },
    reviewedBy: { type: String },
    reviewedAt: { type: Date },
    reviewNotes: { type: String },
  },
  { timestamps: true }
);

export default mongoose.model<ILeaveRequest>("LeaveRequest", LeaveRequestSchema);
