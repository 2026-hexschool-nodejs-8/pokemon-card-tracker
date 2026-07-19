-- CreateTable
CREATE TABLE "Currency" (
    "code" TEXT NOT NULL,
    "rateToTwd" DOUBLE PRECISION NOT NULL,
    "source" TEXT,
    "fetchedAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Currency_pkey" PRIMARY KEY ("code")
);
