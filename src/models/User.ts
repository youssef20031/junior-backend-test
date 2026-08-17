import bcrypt from 'bcryptjs';
import { model, Schema, type HydratedDocument } from 'mongoose';
import { env } from '../config/env';
import { USER_ROLES, type UserRole } from '../types/roles';

export interface IUser {
  email: string;
  /** Always a bcrypt hash on a persisted document — never the plaintext. */
  password: string;
  role: UserRole;
  createdAt: Date;
  updatedAt: Date;
  comparePassword(candidate: string): Promise<boolean>;
}

export type UserDocument = HydratedDocument<IUser>;

/** The safe, public projection of a user. Never contains the password. */
export interface UserResponse {
  id: string;
  email: string;
  role: UserRole;
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<IUser>(
  {
    email: {
      type: String,
      required: [true, 'email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      maxlength: 254,
    },
    password: {
      type: String,
      required: [true, 'password is required'],
      // Excluded from every query by default, so a stray `User.findOne()` can
      // never leak the hash. Login opts back in with `.select('+password')`.
      select: false,
    },
    role: {
      type: String,
      enum: USER_ROLES,
      default: 'user',
      required: true,
    },
  },
  // No `toJSON` transform on purpose: `serializeUser` below is the single,
  // typed path from document to response, so there is no second serialisation
  // rule to keep in sync.
  { timestamps: true },
);

/** Hashes the password whenever it is set or changed — including on seeding. */
userSchema.pre('save', async function hashPassword() {
  if (!this.isModified('password')) {
    return;
  }
  this.password = await bcrypt.hash(this.password, env.bcryptRounds);
});

userSchema.methods.comparePassword = async function comparePassword(
  this: UserDocument,
  candidate: string,
): Promise<boolean> {
  return bcrypt.compare(candidate, this.password);
};

export const User = model<IUser>('User', userSchema);

export function serializeUser(user: UserDocument): UserResponse {
  return {
    id: user._id.toString(),
    email: user.email,
    role: user.role,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}
