BEGIN;

ALTER TABLE "Message" ADD COLUMN "position" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Message" ADD COLUMN "originalTime" TEXT;
CREATE INDEX "Message_chunkId_position_idx" ON "Message"("chunkId", "position");

CREATE TABLE "FileDeletion" (
    "filename" TEXT NOT NULL,
    "clientId" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FileDeletion_pkey" PRIMARY KEY ("filename")
);
CREATE INDEX "FileDeletion_nextAttemptAt_idx" ON "FileDeletion"("nextAttemptAt");
CREATE INDEX "FileDeletion_clientId_idx" ON "FileDeletion"("clientId");

-- Recover the original AI array order where available. Never cast malformed
-- legacy JSON directly: old installations may contain incomplete imports.
CREATE FUNCTION pg_temp.crm_try_jsonb(value TEXT) RETURNS JSONB
LANGUAGE plpgsql AS $$
BEGIN
  RETURN value::jsonb;
EXCEPTION WHEN invalid_text_representation THEN
  RETURN NULL;
END;
$$;

WITH source AS (
  SELECT c.id, pg_temp.crm_try_jsonb(c."extractedInfo") AS data
  FROM "ConversationChunk" c
), parsed AS (
  SELECT s.id AS chunk_id, item->>'sender' AS sender,
    item->>'content' AS content, LEFT(NULLIF(item->>'time', 'null'), 60) AS original_time,
    ordinal AS original_position,
    ROW_NUMBER() OVER (PARTITION BY s.id, item->>'sender', item->>'content' ORDER BY ordinal) AS occurrence
  FROM source s
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(s.data->'messages') = 'array' THEN s.data->'messages' ELSE '[]'::jsonb END
  ) WITH ORDINALITY AS entries(item, ordinal)
), stored AS (
  SELECT m.*,
    ROW_NUMBER() OVER (PARTITION BY "chunkId", sender, content ORDER BY "createdAt", id) AS occurrence
  FROM "Message" m
), recovered AS (
  SELECT m.id, p.original_time,
    ROW_NUMBER() OVER (PARTITION BY m."chunkId" ORDER BY
      CASE WHEN p.original_position IS NULL THEN 1 ELSE 0 END,
      p.original_position, m."timestamp" NULLS LAST, m."createdAt", m.id
    ) - 1 AS position
  FROM stored m LEFT JOIN parsed p ON p.chunk_id = m."chunkId"
    AND p.sender = m.sender AND p.content = m.content AND p.occurrence = m.occurrence
)
UPDATE "Message" m SET "position" = r.position::integer, "originalTime" = r.original_time
FROM recovered r WHERE m.id = r.id;

DROP FUNCTION pg_temp.crm_try_jsonb(TEXT);
COMMIT;
