ALTER TABLE "AdminUser" ADD COLUMN "accessStatus" TEXT NOT NULL DEFAULT 'PENDING';
ALTER TABLE "AdminUser" ADD COLUMN "requestedAt" TIMESTAMP(3);
ALTER TABLE "AdminUser" ADD COLUMN "approvedAt" TIMESTAMP(3);
ALTER TABLE "AdminUser" ADD COLUMN "approvedById" TEXT;

CREATE TABLE "AccessEvent" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "actorId" TEXT,
  "action" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AccessEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AccessEvent_userId_createdAt_idx" ON "AccessEvent"("userId", "createdAt");
ALTER TABLE "AccessEvent" ADD CONSTRAINT "AccessEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "AdminUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
