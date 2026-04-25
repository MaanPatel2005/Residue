/**
 * Minimal HMAC-signed token (JWT-shaped, but we don't pull in a full JWT
 * library — just the three base64url segments).
 *
 * Encoded payload shape: `{ uid, email, iat, exp }`. Signing key comes from
 * `process.env.RESIDUE_AUTH_SECRET`; in development we fall back to a fixed
 * dev secret so local runs don't require any setup.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

const DEV_SECRET = 'residue-dev-secret-change-me';
const ALG = 'HS256';
const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

export interface AuthTokenPayload {
  uid: string;
  email: string;
  iat: number;
  exp: number;
}

function getSecret(): string {
  return process.env.RESIDUE_AUTH_SECRET || DEV_SECRET;
}

function b64urlEncode(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=+$/, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function b64urlDecode(input: string): Buffer {
  const pad = 4 - (input.length % 4 || 4);
  const padded =
    input.replace(/-/g, '+').replace(/_/g, '/') + (pad < 4 ? '='.repeat(pad) : '');
  return Buffer.from(padded, 'base64');
}

function sign(input: string): string {
  return b64urlEncode(createHmac('sha256', getSecret()).update(input).digest());
}

export function createAuthToken(uid: string, email: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: ALG, typ: 'JWT' };
  const payload: AuthTokenPayload = {
    uid,
    email,
    iat: now,
    exp: now + TOKEN_TTL_SECONDS,
  };
  const headerSeg = b64urlEncode(JSON.stringify(header));
  const payloadSeg = b64urlEncode(JSON.stringify(payload));
  const signature = sign(`${headerSeg}.${payloadSeg}`);
  return `${headerSeg}.${payloadSeg}.${signature}`;
}

export function verifyAuthToken(token: string | null | undefined):
  | AuthTokenPayload
  | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [headerSeg, payloadSeg, signature] = parts;
  const expected = sign(`${headerSeg}.${payloadSeg}`);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(b64urlDecode(payloadSeg).toString('utf8')) as
      AuthTokenPayload;
    if (payload.exp <= Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export function bearerFromHeader(header: string | null | undefined): string | null {
  if (!header) return null;
  const m = /^Bearer\s+(.+)$/i.exec(header);
  return m ? m[1].trim() : null;
}
