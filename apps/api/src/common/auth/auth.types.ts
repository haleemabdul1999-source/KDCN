import { StaffRole } from '@prisma/client';
import type { Request } from 'express';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  staffRoles: StaffRole[];
  mfaEnabled: boolean;
}

export interface AuthContext {
  user: AuthUser;
  sessionId: string;
  mfaVerified: boolean;
}

export interface KdcnRequest extends Request {
  auth?: AuthContext;
  rawBody?: Buffer;
  requestId?: string;
}

export const SESSION_COOKIE = 'kdcn_session';
export const GUEST_CART_COOKIE = 'kdcn_cart';
export const CSRF_HEADER = 'x-kdcn-csrf';
