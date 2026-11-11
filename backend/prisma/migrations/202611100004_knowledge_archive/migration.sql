CREATE TABLE "KnowledgeImport" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "bundleHash" TEXT NOT NULL,
  "sourceRoot" TEXT NOT NULL,
  "capturedAt" TIMESTAMP(3) NOT NULL,
  "manifest" JSONB NOT NULL,
  "verifiedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "KnowledgeImport_bundleHash_key" ON "KnowledgeImport"("bundleHash");
CREATE TABLE "KnowledgeSource" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "importId" TEXT NOT NULL REFERENCES "KnowledgeImport"("id") ON DELETE CASCADE,
  "path" TEXT NOT NULL,
  "sha256" TEXT NOT NULL,
  "byteLength" INTEGER NOT NULL,
  "data" BYTEA NOT NULL
);
CREATE UNIQUE INDEX "KnowledgeSource_importId_path_key" ON "KnowledgeSource"("importId", "path");
CREATE TABLE "KnowledgeDocument" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "importId" TEXT NOT NULL REFERENCES "KnowledgeImport"("id") ON DELETE CASCADE,
  "key" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "language" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "categoryCodes" TEXT[] NOT NULL,
  "content" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "sha256" TEXT NOT NULL,
  "sourcePaths" TEXT[] NOT NULL,
  "reviewStatus" TEXT NOT NULL DEFAULT 'SOURCE',
  "issues" TEXT[] NOT NULL
);
CREATE UNIQUE INDEX "KnowledgeDocument_importId_key_key" ON "KnowledgeDocument"("importId", "key");
CREATE INDEX "KnowledgeDocument_importId_language_kind_idx" ON "KnowledgeDocument"("importId", "language", "kind");
CREATE INDEX "KnowledgeDocument_categoryCodes_idx" ON "KnowledgeDocument" USING GIN("categoryCodes");
CREATE TABLE "KnowledgePassage" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "documentId" TEXT NOT NULL REFERENCES "KnowledgeDocument"("id") ON DELETE CASCADE,
  "position" INTEGER NOT NULL,
  "content" TEXT NOT NULL
);
CREATE UNIQUE INDEX "KnowledgePassage_documentId_position_key" ON "KnowledgePassage"("documentId", "position");
