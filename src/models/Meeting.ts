import mongoose, { Schema, Document } from "mongoose";

export type MeetingParticipantStatus = "invited" | "accepted" | "declined";

export interface IMeetingParticipant {
  userId: string;
  status: MeetingParticipantStatus;
  respondedAt?: Date;
}

export interface IMeeting extends Document {
  companyId: string;
  title: string;
  description?: string;
  startAt: Date;
  durationMinutes: number;
  projectId?: string | null;
  createdBy: string;
  participants: IMeetingParticipant[];
  reminderMinutesBefore: number;
  remindedAt?: Date;
  callInvitedAt?: Date;
  callMode: "voice" | "video";
  status: "scheduled" | "cancelled";
}

const ParticipantSchema = new Schema<IMeetingParticipant>(
  {
    userId: { type: String, required: true, index: true },
    status: { type: String, enum: ["invited", "accepted", "declined"], default: "invited" },
    respondedAt: { type: Date },
  },
  { _id: false }
);

const MeetingSchema = new Schema<IMeeting>(
  {
    companyId: { type: String, required: true, index: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, default: null },
    startAt: { type: Date, required: true, index: true },
    durationMinutes: { type: Number, default: 30, min: 5, max: 8 * 60 },
    projectId: { type: String, default: null, index: true },
    createdBy: { type: String, required: true, index: true },
    participants: { type: [ParticipantSchema], default: [] },
    reminderMinutesBefore: { type: Number, default: 10, min: 0, max: 240 },
    remindedAt: { type: Date, default: null },
    callInvitedAt: { type: Date, default: null },
    callMode: { type: String, enum: ["voice", "video"], default: "video" },
    status: { type: String, enum: ["scheduled", "cancelled"], default: "scheduled", index: true },
  },
  { timestamps: true }
);

MeetingSchema.index({ companyId: 1, startAt: 1 });
MeetingSchema.index({ companyId: 1, createdBy: 1, startAt: -1 });

export default mongoose.model<IMeeting>("Meeting", MeetingSchema);
