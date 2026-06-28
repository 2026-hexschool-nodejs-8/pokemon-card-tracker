-- CreateEnum
CREATE TYPE "SourceType" AS ENUM ('api', 'crawler');

-- CreateEnum
CREATE TYPE "JobTriggerType" AS ENUM ('manual', 'cron');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('running', 'success', 'partial_success', 'failed');

-- CreateEnum
CREATE TYPE "LogStatus" AS ENUM ('success', 'failed');

-- CreateEnum
CREATE TYPE "AdminRole" AS ENUM ('admin');

-- CreateTable
CREATE TABLE "Admin" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT,
    "role" "AdminRole" NOT NULL DEFAULT 'admin',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Admin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Card" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "cardNumber" TEXT NOT NULL,
    "setName" TEXT,
    "language" TEXT NOT NULL DEFAULT 'ja',
    "condition" TEXT NOT NULL DEFAULT 'raw',
    "imageUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "latestPrice" DOUBLE PRECISION,
    "latestCurrency" TEXT,
    "lastFetchedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Card_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceSource" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "type" "SourceType" NOT NULL,
    "provider" TEXT NOT NULL,
    "url" TEXT,
    "externalId" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'JPY',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastSuccessAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PriceSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceSnapshot" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL,
    "priceTwd" DOUBLE PRECISION,
    "rawText" TEXT,
    "fetchedAt" TIMESTAMP(3) NOT NULL,
    "isSuspicious" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PriceSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceFetchJob" (
    "id" TEXT NOT NULL,
    "triggerType" "JobTriggerType" NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'running',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "totalSources" INTEGER NOT NULL DEFAULT 0,
    "successCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,

    CONSTRAINT "PriceFetchJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceFetchLog" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "cardId" TEXT,
    "sourceId" TEXT,
    "status" "LogStatus" NOT NULL,
    "message" TEXT,
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PriceFetchLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Admin_email_key" ON "Admin"("email");

-- CreateIndex
CREATE INDEX "Card_name_idx" ON "Card"("name");

-- CreateIndex
CREATE INDEX "Card_cardNumber_idx" ON "Card"("cardNumber");

-- CreateIndex
CREATE INDEX "PriceSource_cardId_idx" ON "PriceSource"("cardId");

-- CreateIndex
CREATE INDEX "PriceSnapshot_cardId_fetchedAt_idx" ON "PriceSnapshot"("cardId", "fetchedAt");

-- CreateIndex
CREATE INDEX "PriceSnapshot_sourceId_idx" ON "PriceSnapshot"("sourceId");

-- CreateIndex
CREATE INDEX "PriceFetchJob_startedAt_idx" ON "PriceFetchJob"("startedAt");

-- CreateIndex
CREATE INDEX "PriceFetchLog_jobId_idx" ON "PriceFetchLog"("jobId");

-- AddForeignKey
ALTER TABLE "PriceSource" ADD CONSTRAINT "PriceSource_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceSnapshot" ADD CONSTRAINT "PriceSnapshot_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceSnapshot" ADD CONSTRAINT "PriceSnapshot_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "PriceSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceFetchLog" ADD CONSTRAINT "PriceFetchLog_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "PriceFetchJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceFetchLog" ADD CONSTRAINT "PriceFetchLog_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceFetchLog" ADD CONSTRAINT "PriceFetchLog_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "PriceSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;
