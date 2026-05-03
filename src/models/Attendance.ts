import mongoose, { Schema, Document } from "mongoose";

export interface IAttendance extends Document {
  companyId: string;
  userId: string;
  date: Date;
  clockIn?: Date;
  clockOut?: Date;
  status: "present" | "absent" | "late" | "half-day" | "leave";
  clockInLocation?: { lat: number; lng: number; address?: string };
  hoursWorked?: number;
  notes?: string;
}

const AttendanceSchema = new Schema<IAttendance>(
  {
    companyId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    date: { type: Date, required: true },
    clockIn: { type: Date },
    clockOut: { type: Date },
    status: {
      type: String,
      enum: ["present", "absent", "late", "half-day", "leave"],
      default: "absent",
    },
    clockInLocation: {
      lat: Number,
      lng: Number,
      address: String,
    },
    hoursWorked: { type: Number },
    notes: { type: String },
  },
  { timestamps: true }
);

// Index compound để tìm nhanh attendance theo user + date
AttendanceSchema.index({ userId: 1, date: 1 }, { unique: true });

export default mongoose.model<IAttendance>("Attendance", AttendanceSchema);
