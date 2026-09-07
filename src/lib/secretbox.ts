import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

/**
 * Reversible storage for admin-set passwords, so the Settings panel can display
 * them back to the admin who set them.
 *
 * Authentication still uses the one-way scrypt hash in `passwordHash` — this is
 * display only. The key is derived from AUTH_SECRET, so a copy of the database
 * on its own is not enough to read these back.
 */
const KEY = scryptSync(process.env.AUTH_SECRET ?? "insecure-dev-secret", "submithub-pw", 32);

export function seal(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", KEY, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), enc.toString("base64")].join(".");
}

export function open(sealed: string | null): string | null {
  if (!sealed) return null;
  const [ivB64, tagB64, dataB64] = sealed.split(".");
  if (!ivB64 || !tagB64 || !dataB64) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", KEY, Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    // Wrong key (AUTH_SECRET rotated) or a tampered value.
    return null;
  }
}
