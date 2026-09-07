-- Add an ADMIN level above CR.
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'ADMIN';

-- Optional sign-in alias, e.g. "CR - Dev". NULL for everyone by default,
-- and Postgres allows unlimited NULLs under a UNIQUE constraint.
ALTER TABLE "Student" ADD COLUMN IF NOT EXISTS "loginId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "Student_loginId_key" ON "Student"("loginId");
