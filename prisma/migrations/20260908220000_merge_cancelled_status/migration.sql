-- A merge the CR stopped by hand. Distinct from FAILED so the history can
-- tell "something broke" apart from "we changed our mind".
ALTER TYPE "MergeStatus" ADD VALUE 'CANCELLED';
