-- Admins added by email are not class members; keep them out of roster views.
ALTER TABLE "Student" ADD COLUMN IF NOT EXISTS "isRosterMember" BOOLEAN NOT NULL DEFAULT true;
