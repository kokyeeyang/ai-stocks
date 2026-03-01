import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import pg from "pg";

const connectionString = process.env.DATABASE_URL;
const pool = new pg.Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

/**
 * Fetch daily OHLCV from Stooq CSV.
 * Example: https://stooq.com/q/d/l/?s=aapl.us&i=d
 */
async function fetchStooqDaily(symbol) {
  const stooqSymbol = `${symbol.toLowerCase()}.us`;
  const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(stooqSymbol)}&i=d`;

  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Stooq fetch failed: ${symbol} (${resp.status})`);

  const csv = await resp.text();
  const lines = csv.trim().split("\n");
  if (lines.length < 3) throw new Error(`No data for ${symbol}`);

  // Date,Open,High,Low,Close,Volume
  return lines
    .slice(1)
    .map((line) => {
      const [date, open, high, low, close, volume] = line.split(",");

      const closeNum = Number(close);
      if (!Number.isFinite(closeNum)) return null;

      // volume can sometimes be "1496329307.4141" so normalize it
      const volNum = volume ? Number(volume) : NaN;
      const volBigInt =
        Number.isFinite(volNum) ? BigInt(Math.floor(volNum)) : null;

      return {
        date: new Date(date + "T00:00:00.000Z"),
        open: open ? Number(open) : null,
        high: high ? Number(high) : null,
        low: low ? Number(low) : null,
        close: closeNum,
        volume: volBigInt,
      };
    })
    .filter(Boolean);
}

/**
 * Upsert ticker and its prices. Uses @@unique(symbol,date) for idempotency.
 */
async function upsertTickerAndPrices(symbol, rows, lookbackDays = 365) {
  const SYM = symbol.toUpperCase().trim();
  if (!/^[A-Z.]{1,10}$/.test(SYM)) throw new Error(`Bad symbol: ${symbol}`);

  await prisma.ticker.upsert({
    where: { symbol: SYM },
    update: { isActive: true },
    create: { symbol: SYM, isActive: true },
  });

  const cutoff = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);
  const recent = rows.filter((r) => r.date >= cutoff);

  // Batch upserts (safe to rerun)
  // Prisma doesn't have "upsertMany", so we do createMany(skipDuplicates) + rely on unique constraint.
  // But createMany won't update existing rows; that's OK for EOD prices (they shouldn't change much).
  // If you want strict updates, we can do per-row upsert (slower).
  await prisma.dailyPrice.createMany({
    data: recent.map((r) => ({
      symbol: SYM,
      date: r.date,
      open: r.open,
      high: r.high,
      low: r.low,
      close: r.close,
      volume: r.volume,
    })),
    skipDuplicates: true,
  });

  return { inserted: recent.length };
}

async function main() {
  // Option A: CLI tickers e.g. `node scripts/ingest-prices.js AAPL MSFT`
  // Option B: Use DB tickers (recommended later)
  const cliTickers = process.argv.slice(2).map((s) => s.toUpperCase());

  let tickers = cliTickers;
  if (tickers.length === 0) {
    // Default set if none supplied
    tickers = ["AAPL", "MSFT", "NVDA", "TSLA", "AMZN", "GOOGL"];
  }

  console.log(`[ingest] tickers=${tickers.join(", ")}`);

  for (const t of tickers) {
    try {
      console.log(`[ingest] fetching ${t}...`);
      const rows = await fetchStooqDaily(t);
      await upsertTickerAndPrices(t, rows, 730); // keep 2 years
      console.log(`[ingest] ok ${t} rows=${rows.length}`);
    } catch (e) {
      console.error(`[ingest] failed ${t}:`, e?.message || e);
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
