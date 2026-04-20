import mongoose, { Schema, Document } from "mongoose";

export interface ICompany extends Document {
  name: string;
  inviteCode: string;
  customInviteCode?: string;
  subdomain?: string;
  logo?: string;
  industry: string;
  size: string;
  address?: string;
  phone?: string;
  website?: string;
  ownerId: string;
  settings: {
    workingHours: { start: string; end: string };
    workingDays: number[];
    annualLeave: number;
    timezone: string;
  };

  jobRoles?: Array<{
    key: string;
    name: string;
    colorToken: string;
  }>;
}

const CompanySchema = new Schema<ICompany>(
  {
    name: { type: String, required: true, trim: true },
    inviteCode: { type: String, required: true, unique: true, uppercase: true },
    customInviteCode: { type: String, unique: true, sparse: true, uppercase: true, trim: true },
    subdomain: { type: String, lowercase: true, trim: true },
    logo: { type: String },
    industry: { type: String, required: true },
    size: { type: String, required: true, enum: ["1-10", "11-50", "51-200", "200+"] },
    address: { type: String },
    phone: { type: String },
    website: { type: String },
    ownerId: { type: String, required: true },
    settings: {
      workingHours: {
        start: { type: String, default: "08:00" },
        end: { type: String, default: "17:30" },
      },
      workingDays: { type: [Number], default: [1, 2, 3, 4, 5] },
      annualLeave: { type: Number, default: 12 },
      timezone: { type: String, default: "Asia/Ho_Chi_Minh" },
    },

    // Company-scoped job roles (NOT permission roles).
    jobRoles: {
      type: [
        {
          key: { type: String, required: true, trim: true },
          name: { type: String, required: true, trim: true },
          colorToken: { type: String, required: true, trim: true },
        },
      ],
      default: [],
    },
  },
  { timestamps: true }
);

export default mongoose.model<ICompany>("Company", CompanySchema);
