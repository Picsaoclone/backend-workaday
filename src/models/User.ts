import mongoose, { Schema, Document } from "mongoose";
import bcrypt from "bcryptjs";

export interface IUser extends Document {
  email: string;
  password: string;
  name: string;
  phone?: string;
  avatar?: string;
  companyId?: string;
  role: "admin" | "manager" | "employee";
  jobRoleKey?: string;
  position?: string;
  departmentId?: string;
  managerId?: string;
  bio?: string;
  joinedAt: Date;
  leaveBalance: number;
  notifications: {
    email: boolean;
    push: boolean;
    desktop: boolean;
  };
  isActive: boolean;
  lastSeen: Date;
  resetPasswordToken?: string;
  resetPasswordExpires?: Date;
  comparePassword(candidatePassword: string): Promise<boolean>;
}

const UserSchema = new Schema<IUser>(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true, minlength: 8 },
    name: { type: String, required: true, trim: true },
    phone: { type: String, trim: true },
    avatar: { type: String },
    companyId: { type: String, default: null },
    role: { type: String, enum: ["admin", "manager", "employee"], default: "employee" },
    jobRoleKey: { type: String, default: null, trim: true },
    position: { type: String, trim: true },
    departmentId: { type: String, default: null },
    managerId: { type: String, default: null },
    bio: { type: String, maxlength: 500 },
    joinedAt: { type: Date, default: Date.now },
    leaveBalance: { type: Number, default: 12 },
    notifications: {
      email: { type: Boolean, default: true },
      push: { type: Boolean, default: true },
      desktop: { type: Boolean, default: true },
    },
    isActive: { type: Boolean, default: true },
    lastSeen: { type: Date, default: Date.now },
    resetPasswordToken: { type: String, default: null, select: false },
    resetPasswordExpires: { type: Date, default: null, select: false },
  },
  { timestamps: true }
);

// Hash password trước khi lưu
UserSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

// So sánh password
UserSchema.methods.comparePassword = async function (candidatePassword: string): Promise<boolean> {
  return bcrypt.compare(candidatePassword, this.password);
};

// Không trả về password khi toJSON
UserSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.password;
  return obj;
};

export default mongoose.model<IUser>("User", UserSchema);
