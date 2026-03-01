-- AlterTable
ALTER TABLE "StockAnalysis" ADD COLUMN     "cached" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "portfolioId" TEXT,
ADD COLUMN     "watchlistId" TEXT;

-- CreateIndex
CREATE INDEX "StockAnalysis_watchlistId_createdAt_idx" ON "StockAnalysis"("watchlistId", "createdAt");

-- CreateIndex
CREATE INDEX "StockAnalysis_portfolioId_createdAt_idx" ON "StockAnalysis"("portfolioId", "createdAt");
