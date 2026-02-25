-- CreateTable
CREATE TABLE "Ticker" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Ticker_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyPrice" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "open" DOUBLE PRECISION,
    "high" DOUBLE PRECISION,
    "low" DOUBLE PRECISION,
    "close" DOUBLE PRECISION NOT NULL,
    "volume" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailyPrice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Ticker_symbol_key" ON "Ticker"("symbol");

-- CreateIndex
CREATE INDEX "DailyPrice_symbol_date_idx" ON "DailyPrice"("symbol", "date");

-- CreateIndex
CREATE UNIQUE INDEX "DailyPrice_symbol_date_key" ON "DailyPrice"("symbol", "date");

-- AddForeignKey
ALTER TABLE "DailyPrice" ADD CONSTRAINT "DailyPrice_symbol_fkey" FOREIGN KEY ("symbol") REFERENCES "Ticker"("symbol") ON DELETE CASCADE ON UPDATE CASCADE;
