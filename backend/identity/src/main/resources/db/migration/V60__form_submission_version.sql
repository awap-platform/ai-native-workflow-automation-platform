-- Phase 6: remember which form definition version a submission answered.

ALTER TABLE form_submissions ADD COLUMN form_version INTEGER NOT NULL DEFAULT 1;
