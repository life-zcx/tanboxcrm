ALTER TABLE "AISuggestion" ADD COLUMN "commercialEvidence" JSONB;
CREATE TABLE "CommercialQuote" (
  "id" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "pricingHash" TEXT NOT NULL,
  "pricingCheckedAt" TIMESTAMP(3) NOT NULL,
  "pricingSourceUrl" TEXT NOT NULL,
  "request" JSONB NOT NULL,
  "calculation" JSONB NOT NULL,
  "pricingSnapshot" JSONB NOT NULL,
  "total" DECIMAL(16,2) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewAfter" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  CONSTRAINT "CommercialQuote_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CommercialQuote_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "CommercialQuote_clientId_createdAt_idx" ON "CommercialQuote"("clientId", "createdAt");
