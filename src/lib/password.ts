import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const KEYLEN = 64;
const SALT_BYTES = 16;

/** scrypt with a per-user random salt. Stored as "salt:hash", both hex. */
export function hashPassword(plain: string): string {
  const salt = randomBytes(SALT_BYTES);
  const hash = scryptSync(plain.normalize("NFKC"), salt, KEYLEN);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

export function verifyPassword(plain: string, stored: string | null): boolean {
  if (!stored) return false;
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  try {
    const expected = Buffer.from(hashHex, "hex");
    const actual = scryptSync(plain.normalize("NFKC"), Buffer.from(saltHex, "hex"), expected.length);
    return timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

/**
 * Readable one-time passwords: no 0/O/1/l/I, so they survive being written on
 * a whiteboard or read out loud.
 */
export function generatePassword(length = 10): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyzACDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}
