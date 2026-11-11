CREATE TABLE "ScreenshotDraft" (
    "id" TEXT NOT NULL,
    "telegramUserId" TEXT NOT NULL,
    "targetClientId" TEXT,
    "imageUrls" TEXT[] NOT NULL,
    "parsed" JSONB NOT NULL,
    "reviewToken" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ScreenshotDraft_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ScreenshotDraft_telegramUserId_idx" ON "ScreenshotDraft"("telegramUserId");
CREATE INDEX "ScreenshotDraft_expiresAt_idx" ON "ScreenshotDraft"("expiresAt");
