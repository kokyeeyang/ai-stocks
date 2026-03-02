/*
  Warnings:

  - You are about to drop the `PortfolioHolding` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "PortfolioTransactionType" AS ENUM ('BUY', 'SELL');

-- DropForeignKey
ALTER TABLE "PortfolioHolding" DROP CONSTRAINT "PortfolioHolding_portfolioId_fkey";

-- DropTable
DROP TABLE "PortfolioHolding";

-- CreateTable
CREATE TABLE "PortfolioTransaction" (
    "id" TEXT NOT NULL,
    "type" "PortfolioTransactionType" NOT NULL DEFAULT 'BUY',
    "symbol" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "notes" TEXT,
    "executedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "portfolioId" TEXT NOT NULL,

    CONSTRAINT "PortfolioTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PortfolioTransaction_portfolioId_executedAt_idx" ON "PortfolioTransaction"("portfolioId", "executedAt");

-- CreateIndex
CREATE INDEX "PortfolioTransaction_symbol_idx" ON "PortfolioTransaction"("symbol");

-- AddForeignKey
ALTER TABLE "PortfolioTransaction" ADD CONSTRAINT "PortfolioTransaction_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "Portfolio"("id") ON DELETE CASCADE ON UPDATE CASCADE;
