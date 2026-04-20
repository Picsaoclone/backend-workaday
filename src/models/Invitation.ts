import mongoose, { Schema, Document } from "mongoose";

export interface IInvitation extends Document {
  companyId: string;
  email: string;
  role: "employee" | "manager";
  code: string;
  invitedBy: string;
  expiresAt: Date;
  used: boolean;
  usedAt?: Date;
  usedBy?: string;
}

const InvitationSchema = new Schema<IInvitation>(
  {
    companyId: { type: String, required: true, index: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    role: { type: String, enum: ["employee", "manager"], default: "employee" },
    code: { type: String, required: true, unique: true },
    invitedBy: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    used: { type: Boolean, default: false },
    usedAt: { type: Date },
    usedBy: { type: String },
  },
  { timestamps: true }
);

export default mongoose.model<IInvitation>("Invitation", InvitationSchema);
