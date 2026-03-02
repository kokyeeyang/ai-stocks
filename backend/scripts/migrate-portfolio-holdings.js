import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import pg from "pg";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const connectionString = process.env.DATABASE_URL;
const pool = new pg.Pool({ connectionString });

const mode = process.argv[2];
const defaultBackupPath = path.resolve(__dirname, "../prisma/backups/portfolio-holdings.json");
const backupPath = path.resolve(process.argv[3] || defaultBackupPath);

async function tableExists(client, tableName) {
  const result = await client.query(
    `
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = $1
      ) AS "exists"
    `,
    [tableName]
  );

  return Boolean(result.rows[0]?.exists);
}

async function exportHoldings() {
  const client = await pool.connect();
  try {
    const hasOldTable = await tableExists(client, "PortfolioHolding");
    if (!hasOldTable) {
      throw new Error('Table "PortfolioHolding" does not exist. Nothing to export.');
    }

    const result = await client.query(`
      SELECT
        "id",
        "portfolioId",
        "symbol",
        "quantity",
        "averageCost",
        "notes",
        "createdAt",
        "updatedAt"
      FROM "PortfolioHolding"
      ORDER BY "createdAt" ASC
    `);

    await fs.mkdir(path.dirname(backupPath), { recursive: true });
    await fs.writeFile(backupPath, JSON.stringify(result.rows, null, 2), "utf8");

    const missingCostCount = result.rows.filter((row) => row.averageCost === null).length;
    console.log(`[migrate-holdings] exported ${result.rows.length} holdings to ${backupPath}`);
    if (missingCostCount > 0) {
      console.log(`[migrate-holdings] warning: ${missingCostCount} holdings have no averageCost and will be skipped on import`);
    }
  } finally {
    client.release();
  }
}

async function importHoldings() {
  const client = await pool.connect();
  try {
    const hasNewTable = await tableExists(client, "PortfolioTransaction");
    if (!hasNewTable) {
      throw new Error('Table "PortfolioTransaction" does not exist. Run your Prisma migration first.');
    }

    const raw = await fs.readFile(backupPath, "utf8");
    const holdings = JSON.parse(raw);

    let inserted = 0;
    let skipped = 0;

    for (const holding of holdings) {
      if (holding.averageCost === null || Number(holding.averageCost) <= 0) {
        skipped += 1;
        continue;
      }

      const migrationTag = `[migrated-from-holding:${holding.id}]`;
      const existing = await client.query(
        `
          SELECT 1
          FROM "PortfolioTransaction"
          WHERE "portfolioId" = $1
            AND "notes" = $2
          LIMIT 1
        `,
        [holding.portfolioId, migrationTag]
      );

      if (existing.rowCount > 0) {
        skipped += 1;
        continue;
      }

      await client.query(
        `
          INSERT INTO "PortfolioTransaction" (
            "id",
            "type",
            "symbol",
            "quantity",
            "price",
            "notes",
            "executedAt",
            "createdAt",
            "portfolioId"
          ) VALUES ($1, 'BUY', $2, $3, $4, $5, $6, $7, $8)
        `,
        [
          randomUUID(),
          holding.symbol,
          Number(holding.quantity),
          Number(holding.averageCost),
          migrationTag,
          holding.createdAt,
          holding.createdAt,
          holding.portfolioId,
        ]
      );

      inserted += 1;
    }

    console.log(`[migrate-holdings] imported ${inserted} holdings as BUY transactions`);
    if (skipped > 0) {
      console.log(`[migrate-holdings] skipped ${skipped} holdings (already imported or missing averageCost)`);
    }
  } finally {
    client.release();
  }
}

async function main() {
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }

  if (mode === "export") {
    await exportHoldings();
    return;
  }

  if (mode === "import") {
    await importHoldings();
    return;
  }

  console.log("Usage:");
  console.log("  node scripts/migrate-portfolio-holdings.js export");
  console.log("  node scripts/migrate-portfolio-holdings.js import");
  console.log("Optional backup path:");
  console.log("  node scripts/migrate-portfolio-holdings.js export prisma/backups/my-holdings.json");
}

main()
  .catch((error) => {
    console.error("[migrate-holdings] failed:", error.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
