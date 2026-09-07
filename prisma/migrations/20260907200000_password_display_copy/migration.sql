-- Sealed (AES-GCM) copy of an admin-set password, for display in the admin
-- panel only. Authentication continues to use the scrypt hash.
ALTER TABLE "Student" ADD COLUMN IF NOT EXISTS "passwordEnc" TEXT;
