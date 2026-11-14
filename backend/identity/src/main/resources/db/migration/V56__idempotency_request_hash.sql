-- Issue #283: bind an idempotency key to the request payload so the same key cannot silently
-- replay a different intent. Existing rows keep a NULL hash and continue to replay for
-- compatibility until they age out through IdempotencyPurgeScheduler.
ALTER TABLE idempotency_records ADD COLUMN request_hash VARCHAR(64);
