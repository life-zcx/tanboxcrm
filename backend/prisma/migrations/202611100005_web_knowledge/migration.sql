CREATE TABLE "WebKnowledgeCategory" ("code" TEXT PRIMARY KEY, "title" TEXT NOT NULL, "aliases" TEXT[] NOT NULL);
CREATE TABLE "WebKnowledgeSource" (
 "id" TEXT PRIMARY KEY, "url" TEXT NOT NULL UNIQUE, "title" TEXT NOT NULL, "authority" TEXT NOT NULL,
 "language" TEXT NOT NULL DEFAULT 'ru', "categoryCodes" TEXT[] NOT NULL, "topics" TEXT[] NOT NULL,
 "discoveredFrom" TEXT, "depth" INTEGER NOT NULL DEFAULT 0, "priority" INTEGER NOT NULL DEFAULT 50,
 "intervalHours" INTEGER NOT NULL DEFAULT 24, "enabled" BOOLEAN NOT NULL DEFAULT true,
 "status" TEXT NOT NULL DEFAULT 'PENDING', "lastError" TEXT, "lastHttpStatus" INTEGER,
 "lastAttemptAt" TIMESTAMP(3), "lastSuccessAt" TIMESTAMP(3), "nextCheckAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "lockedUntil" TIMESTAMP(3), "currentRevisionId" TEXT
);
CREATE INDEX "WebKnowledgeSource_enabled_nextCheckAt_idx" ON "WebKnowledgeSource"("enabled", "nextCheckAt");
CREATE INDEX "WebKnowledgeSource_categoryCodes_idx" ON "WebKnowledgeSource" USING GIN("categoryCodes");
CREATE TABLE "WebKnowledgeRevision" (
 "id" TEXT PRIMARY KEY, "sourceId" TEXT NOT NULL REFERENCES "WebKnowledgeSource"("id") ON DELETE CASCADE,
 "sha256" TEXT NOT NULL, "contentHash" TEXT NOT NULL, "finalUrl" TEXT NOT NULL, "contentType" TEXT NOT NULL,
 "data" BYTEA NOT NULL, "text" TEXT NOT NULL, "title" TEXT NOT NULL, "quality" TEXT NOT NULL,
 "metadata" JSONB NOT NULL, "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "WebKnowledgeRevision_sourceId_sha256_contentHash_key" ON "WebKnowledgeRevision"("sourceId", "sha256", "contentHash");
ALTER TABLE "KnowledgeItem" ADD COLUMN "reviewStatus" TEXT NOT NULL DEFAULT 'DRAFT';
CREATE TABLE "WebKnowledgePassage" (
 "id" TEXT PRIMARY KEY, "revisionId" TEXT NOT NULL REFERENCES "WebKnowledgeRevision"("id") ON DELETE CASCADE,
 "position" INTEGER NOT NULL, "content" TEXT NOT NULL,
 "searchVector" TSVECTOR GENERATED ALWAYS AS (to_tsvector('russian', "content")) STORED
);
CREATE UNIQUE INDEX "WebKnowledgePassage_revisionId_position_key" ON "WebKnowledgePassage"("revisionId", "position");
CREATE INDEX "WebKnowledgePassage_search_idx" ON "WebKnowledgePassage" USING GIN("searchVector");
CREATE TABLE "WebKnowledgeFact" (
 "id" TEXT PRIMARY KEY, "key" TEXT NOT NULL UNIQUE, "title" TEXT NOT NULL, "answer" TEXT NOT NULL,
 "categoryCodes" TEXT[] NOT NULL, "topic" TEXT NOT NULL, "keywords" TEXT[] NOT NULL, "conditions" JSONB NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'DRAFT', "reviewedBy" TEXT NOT NULL, "reviewedAt" TIMESTAMP(3) NOT NULL,
 "validFrom" TIMESTAMP(3), "validTo" TIMESTAMP(3), "reviewDueAt" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "WebKnowledgeEvidence" (
 "id" TEXT PRIMARY KEY, "factId" TEXT NOT NULL REFERENCES "WebKnowledgeFact"("id") ON DELETE CASCADE,
 "revisionId" TEXT NOT NULL REFERENCES "WebKnowledgeRevision"("id") ON DELETE RESTRICT,
 "quote" TEXT NOT NULL, "locator" TEXT NOT NULL
);
CREATE INDEX "WebKnowledgeEvidence_factId_idx" ON "WebKnowledgeEvidence"("factId");
CREATE INDEX "WebKnowledgeEvidence_revisionId_idx" ON "WebKnowledgeEvidence"("revisionId");
CREATE TABLE "WebKnowledgeRun" ("id" TEXT PRIMARY KEY, "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "finishedAt" TIMESTAMP(3), "state" TEXT NOT NULL DEFAULT 'RUNNING', "result" JSONB);
ALTER TABLE "AISuggestion" ADD COLUMN "knowledgeEvidence" JSONB;
