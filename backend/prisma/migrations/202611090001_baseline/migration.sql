-- CreateTable
CREATE TABLE "Client" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "company" TEXT,
    "binIin" TEXT,
    "category" TEXT,
    "status" TEXT NOT NULL DEFAULT 'LEAD',
    "stage" TEXT NOT NULL DEFAULT 'NEW',
    "estimatedVolume" INTEGER,
    "estimatedAmount" DOUBLE PRECISION,
    "aiSummary" TEXT,
    "aiSentiment" TEXT,
    "aiObjections" TEXT,
    "aiNextStep" TEXT,
    "notes" TEXT,
    "lastContactAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationChunk" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'WHATSAPP',
    "rawText" TEXT,
    "screenshotUrl" TEXT,
    "summary" TEXT,
    "extractedInfo" TEXT,
    "source" TEXT NOT NULL DEFAULT 'WEB_PANEL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationChunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "chunkId" TEXT NOT NULL,
    "sender" TEXT NOT NULL,
    "senderName" TEXT,
    "content" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AISuggestion" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT,
    "promptType" TEXT NOT NULL,
    "query" TEXT,
    "suggestedText" TEXT NOT NULL,
    "explanation" TEXT,
    "wasCopied" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AISuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Deal" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "stage" TEXT NOT NULL DEFAULT 'NEW',
    "amount" DOUBLE PRECISION,
    "services" TEXT,
    "codesCount" INTEGER,
    "deadline" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Deal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeItem" (
    "id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemSetting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "description" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemSetting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "AuthCode" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "telegramChatId" TEXT NOT NULL,
    "telegramUsername" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "isUsed" BOOLEAN NOT NULL DEFAULT false,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminUser" (
    "id" TEXT NOT NULL,
    "telegramChatId" TEXT NOT NULL,
    "telegramUsername" TEXT,
    "role" TEXT NOT NULL DEFAULT 'ADMIN',
    "lastLoginAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminUser_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Client_phone_idx" ON "Client"("phone");

-- CreateIndex
CREATE INDEX "Client_status_idx" ON "Client"("status");

-- CreateIndex
CREATE INDEX "Client_company_idx" ON "Client"("company");

-- CreateIndex
CREATE INDEX "ConversationChunk_clientId_idx" ON "ConversationChunk"("clientId");

-- CreateIndex
CREATE INDEX "ConversationChunk_createdAt_idx" ON "ConversationChunk"("createdAt");

-- CreateIndex
CREATE INDEX "Message_chunkId_idx" ON "Message"("chunkId");

-- CreateIndex
CREATE INDEX "AISuggestion_clientId_idx" ON "AISuggestion"("clientId");

-- CreateIndex
CREATE INDEX "Deal_clientId_idx" ON "Deal"("clientId");

-- CreateIndex
CREATE INDEX "Deal_stage_idx" ON "Deal"("stage");

-- CreateIndex
CREATE INDEX "KnowledgeItem_category_idx" ON "KnowledgeItem"("category");

-- CreateIndex
CREATE INDEX "AuthCode_code_idx" ON "AuthCode"("code");

-- CreateIndex
CREATE INDEX "AuthCode_telegramChatId_idx" ON "AuthCode"("telegramChatId");

-- CreateIndex
CREATE UNIQUE INDEX "AdminUser_telegramChatId_key" ON "AdminUser"("telegramChatId");

-- CreateIndex
CREATE INDEX "AdminUser_telegramChatId_idx" ON "AdminUser"("telegramChatId");

-- AddForeignKey
ALTER TABLE "ConversationChunk" ADD CONSTRAINT "ConversationChunk_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_chunkId_fkey" FOREIGN KEY ("chunkId") REFERENCES "ConversationChunk"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AISuggestion" ADD CONSTRAINT "AISuggestion_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

