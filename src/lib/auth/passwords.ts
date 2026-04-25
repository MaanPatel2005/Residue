/**
 * Password hashing helpers for the lightweight account system used by
 * desktop ↔ mobile pairing.
 *
 * We use scrypt (via Node's built-in `crypto`) so we never have to ship a
 * native bcrypt binary and stay edge/serverless-safe in any Next.js runtime
 * that supports `node:crypto`.
 *
 * Stored format: `scrypt$<saltHex>$<hashHex>` — versioned so we can rotate
 * KDF parameters later without a migration script.
 */

import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

const SALT_BYTES = 16;
const KEY_BYTES = 32;
const STORED_PREFIX = 'scrypt$';

export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const derived = await scrypt(plain, salt, KEY_BYTES);
  return `${STORED_PREFIX}${salt.toString('hex')}$${derived.toString('hex')}`;
}

export async function verifyPassword(
  plain: string,
  stored: string,
): Promise<boolean> {
  if (!stored.startsWith(STORED_PREFIX)) return false;
  const [, saltHex, hashHex] = stored.split('$');
  if (!saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(hashHex, 'hex');
  const derived = await scrypt(plain, salt, expected.length);
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}
