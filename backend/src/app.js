import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { z } from "zod";
import { normalizeTicker } from "./tickers.js";

const COOKIE_NAME = "session";

const tickerSchema = z
  .string()
  .trim()
  .transform((value) => normalizeTicker(value))
  .refine((value) => value !== null, { message: "Invalid ticker" });
const watchlistSchema = z.object({
  name: z.string().trim().min(1).max(50),
});
const watchlistItemSchema = z.object({
  symbol: tickerSchema,
  notes: z.string().trim().max(200).optional(),
});
const portfolioSchema = z.object({
  name: z.string().trim().min(1).max(50),
});
const portfolioTransactionSchema = z.object({
  symbol: tickerSchema,
  type: z.enum(["BUY", "SELL"]).default("BUY"),
  quantity: z.number().positive(),
  price: z.number().positive(),
  notes: z.string().trim().max(200).optional(),
  executedAt: z.string().datetime().optional(),
});
const analyzeQuerySchema = z.object({
  ticker: tickerSchema,
  watchlistId: z.string().trim().min(1).optional(),
  portfolioId: z.string().trim().min(1).optional(),
});

export function derivePortfolioPositions(transactions, latestCloseMap = new Map()) {
  const positionsMap = new Map();
  let realizedPnL = 0;

  const sortedTransactions = transactions
    .slice()
    .sort((a, b) => new Date(a.executedAt).getTime() - new Date(b.executedAt).getTime());

  for (const tx of sortedTransactions) {
    const current = positionsMap.get(tx.symbol) || {
      symbol: tx.symbol,
      quantity: 0,
      averageCost: 0,
      totalCostBasis: 0,
      buyTransactions: 0,
      sellTransactions: 0,
    };

    if (tx.type === "BUY") {
      current.totalCostBasis += tx.quantity * tx.price;
      current.quantity += tx.quantity;
      current.buyTransactions += 1;
    } else {
      const avgCost = current.quantity > 0 ? current.totalCostBasis / current.quantity : 0;
      const sellQuantity = tx.quantity;
      current.totalCostBasis = Math.max(0, current.totalCostBasis - sellQuantity * avgCost);
      current.quantity = Math.max(0, current.quantity - sellQuantity);
      current.sellTransactions += 1;
      realizedPnL += sellQuantity * (tx.price - avgCost);
    }

    current.averageCost = current.quantity > 0 ? current.totalCostBasis / current.quantity : 0;
    positionsMap.set(tx.symbol, current);
  }

  const positions = [...positionsMap.values()]
    .filter((position) => position.quantity > 0)
    .map((position) => {
      const latestClose = latestCloseMap.get(position.symbol) ?? null;
      const marketValue = latestClose !== null ? Number((position.quantity * latestClose).toFixed(2)) : null;
      const costBasis = Number(position.totalCostBasis.toFixed(2));
      const unrealizedPnL = marketValue !== null ? Number((marketValue - costBasis).toFixed(2)) : null;

      return {
        symbol: position.symbol,
        quantity: Number(position.quantity.toFixed(4)),
        averageCost: Number(position.averageCost.toFixed(2)),
        costBasis,
        latestClose,
        marketValue,
        unrealizedPnL,
        buyTransactions: position.buyTransactions,
        sellTransactions: position.sellTransactions,
      };
    });

  return {
    positions,
    realizedPnL: Number(realizedPnL.toFixed(2)),
  };
}

function computeSimpleStats(rows, days = 30) {
  const recent = rows.slice(-days);
  const first = recent[0];
  const last = recent[recent.length - 1];
  const changePct = first ? ((last.close - first.close) / first.close) * 100 : 0;

  const closes = recent.map((r) => r.close);
  const avgClose = closes.reduce((a, b) => a + b, 0) / Math.max(1, closes.length);

  let vol = 0;
  for (let i = 1; i < recent.length; i++) {
    const prev = recent[i - 1].close;
    const cur = recent[i].close;
    vol += Math.abs((cur - prev) / prev) * 100;
  }

  const avgAbsDailyMovePct = vol / Math.max(1, recent.length - 1);

  return {
    windowDays: recent.length,
    startDate: first?.date,
    endDate: last?.date,
    startClose: first?.close,
    endClose: last?.close,
    changePct: Number(changePct.toFixed(2)),
    avgClose: Number(avgClose.toFixed(2)),
    avgAbsDailyMovePct: Number(avgAbsDailyMovePct.toFixed(2)),
  };
}

export function createApp({
  prisma,
  openai,
  jwtSecret,
  frontendOrigin = "",
  nodeEnv = "development",
}) {
  const app = express();
  const normalizedProdOrigin = frontendOrigin.replace(/\/$/, "");
  const vercelPreviewRegex = /^https:\/\/ai-stocks-.*\.vercel\.app$/;
  const signingKey = typeof jwtSecret === "string" ? new TextEncoder().encode(jwtSecret) : jwtSecret;

  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());
  app.use(cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);

      const normalizedOrigin = origin.replace(/\/$/, "");
      if (normalizedOrigin === normalizedProdOrigin) return cb(null, true);
      if (vercelPreviewRegex.test(normalizedOrigin)) return cb(null, true);

      return cb(new Error(`CORS blocked: ${normalizedOrigin}`));
    },
    credentials: true,
  }));
  app.options("*", cors());

  function isProd() {
    return nodeEnv === "production";
  }

  async function signSession(payload) {
    return await new SignJWT(payload)
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("7d")
      .sign(signingKey);
  }

  async function requireAuth(req, res, next) {
    try {
      const token = req.cookies[COOKIE_NAME];
      if (!token) return res.status(401).json({ error: "Not authenticated" });

      const { payload } = await jwtVerify(token, signingKey);
      req.user = payload;
      next();
    } catch {
      return res.status(401).json({ error: "Invalid session" });
    }
  }

  function setSessionCookie(res, token) {
    res.cookie(COOKIE_NAME, token, {
      httpOnly: true,
      secure: isProd(),
      sameSite: isProd() ? "none" : "lax",
      path: "/",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
  }

  async function buildLatestCloseMap(symbols) {
    const uniqueSymbols = [...new Set(symbols.filter(Boolean))];
    if (!uniqueSymbols.length) return new Map();

    const latestRows = await Promise.all(uniqueSymbols.map(async (symbol) => {
      const latest = await prisma.dailyPrice.findFirst({
        where: { symbol },
        orderBy: { date: "desc" },
        select: { symbol: true, close: true },
      });

      return latest ? [latest.symbol, latest.close] : null;
    }));

    return new Map(latestRows.filter(Boolean));
  }

  async function getOwnedWatchlistOrNull(userId, watchlistId) {
    return prisma.watchlist.findFirst({
      where: { id: watchlistId, userId },
    });
  }

  async function getOwnedPortfolioOrNull(userId, portfolioId) {
    return prisma.portfolio.findFirst({
      where: { id: portfolioId, userId },
    });
  }

  function toAnalysisResponse(analysis) {
    return {
      id: analysis.id,
      ticker: analysis.ticker,
      summary: analysis.summary,
      data: analysis.dataJson,
      cached: analysis.cached,
      createdAt: analysis.createdAt,
      watchlistId: analysis.watchlistId,
      portfolioId: analysis.portfolioId,
    };
  }

  app.post("/auth/signup", async (req, res) => {
    const schema = z.object({
      email: z.string().email(),
      password: z.string().min(8).max(72),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const { email, password } = parsed.data;
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return res.status(409).json({ error: "Email already in use" });

    const hash = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: { email, password: hash },
      select: { id: true, email: true },
    });

    const token = await signSession({ sub: user.id, email: user.email });
    setSessionCookie(res, token);

    res.json({ ok: true, user });
  });

  app.post("/auth/login", async (req, res) => {
    const schema = z.object({
      email: z.string().email(),
      password: z.string().min(1).max(72),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const { email, password } = parsed.data;
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.status(401).json({ error: "Invalid credentials" });

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ error: "Invalid credentials" });

    const token = await signSession({ sub: user.id, email: user.email });
    setSessionCookie(res, token);

    res.json({ ok: true, user: { id: user.id, email: user.email } });
  });

  app.post("/auth/logout", (req, res) => {
    res.clearCookie(COOKIE_NAME, {
      httpOnly: true,
      secure: isProd(),
      sameSite: isProd() ? "none" : "lax",
      path: "/",
    });

    res.json({ ok: true });
  });

  app.get("/me", requireAuth, async (req, res) => {
    res.json({ ok: true, user: { id: req.user.sub, email: req.user.email } });
  });

  app.get("/watchlists", requireAuth, async (req, res) => {
    const watchlists = await prisma.watchlist.findMany({
      where: { userId: req.user.sub },
      include: {
        items: {
          orderBy: { createdAt: "desc" },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    res.json({ ok: true, watchlists });
  });

  app.post("/watchlists", requireAuth, async (req, res) => {
    const parsed = watchlistSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const watchlist = await prisma.watchlist.create({
      data: {
        userId: req.user.sub,
        name: parsed.data.name,
      },
      include: { items: true },
    });

    res.json({ ok: true, watchlist });
  });

  app.post("/watchlists/:id/items", requireAuth, async (req, res) => {
    const parsed = watchlistItemSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const watchlist = await getOwnedWatchlistOrNull(req.user.sub, req.params.id);
    if (!watchlist) return res.status(404).json({ error: "Watchlist not found" });

    try {
      const item = await prisma.watchlistItem.create({
        data: {
          watchlistId: watchlist.id,
          symbol: parsed.data.symbol,
          notes: parsed.data.notes,
        },
      });

      res.json({ ok: true, item });
    } catch (error) {
      if (error?.code === "P2002") {
        return res.status(409).json({ error: "Ticker already exists in this watchlist" });
      }
      throw error;
    }
  });

  app.delete("/watchlists/:id/items/:symbol", requireAuth, async (req, res) => {
    const watchlist = await getOwnedWatchlistOrNull(req.user.sub, req.params.id);
    if (!watchlist) return res.status(404).json({ error: "Watchlist not found" });

    await prisma.watchlistItem.delete({
      where: {
        watchlistId_symbol: {
          watchlistId: watchlist.id,
          symbol: String(req.params.symbol || "").trim().toUpperCase(),
        },
      },
    }).catch(() => null);

    res.json({ ok: true });
  });

  app.get("/portfolios", requireAuth, async (req, res) => {
    const portfolios = await prisma.portfolio.findMany({
      where: { userId: req.user.sub },
      include: {
        transactions: {
          orderBy: [{ executedAt: "desc" }, { createdAt: "desc" }],
        },
      },
      orderBy: { createdAt: "desc" },
    });

    const allSymbols = portfolios.flatMap((portfolio) => portfolio.transactions.map((transaction) => transaction.symbol));
    const latestCloseMap = await buildLatestCloseMap(allSymbols);

    const enrichedPortfolios = portfolios.map((portfolio) => {
      const { positions, realizedPnL } = derivePortfolioPositions(portfolio.transactions, latestCloseMap);
      const totalMarketValue = positions.reduce((sum, position) => sum + (position.marketValue || 0), 0);
      const totalCostBasis = positions.reduce((sum, position) => sum + (position.costBasis || 0), 0);

      return {
        ...portfolio,
        positions,
        summary: {
          totalMarketValue: Number(totalMarketValue.toFixed(2)),
          totalCostBasis: Number(totalCostBasis.toFixed(2)),
          unrealizedPnL: Number((totalMarketValue - totalCostBasis).toFixed(2)),
          realizedPnL,
        },
      };
    });

    res.json({ ok: true, portfolios: enrichedPortfolios });
  });

  app.post("/portfolios", requireAuth, async (req, res) => {
    const parsed = portfolioSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const portfolio = await prisma.portfolio.create({
      data: {
        userId: req.user.sub,
        name: parsed.data.name,
      },
      include: { transactions: true },
    });

    res.json({ ok: true, portfolio });
  });

  app.post("/portfolios/:id/transactions", requireAuth, async (req, res) => {
    const parsed = portfolioTransactionSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const portfolio = await getOwnedPortfolioOrNull(req.user.sub, req.params.id);
    if (!portfolio) return res.status(404).json({ error: "Portfolio not found" });

    if (parsed.data.type === "SELL") {
      const existingTransactions = await prisma.portfolioTransaction.findMany({
        where: {
          portfolioId: portfolio.id,
          symbol: parsed.data.symbol,
        },
        orderBy: [{ executedAt: "asc" }, { createdAt: "asc" }],
      });

      const { positions } = derivePortfolioPositions(existingTransactions);
      const currentPosition = positions.find((position) => position.symbol === parsed.data.symbol);
      const availableQuantity = currentPosition?.quantity || 0;

      if (availableQuantity < parsed.data.quantity) {
        return res.status(400).json({
          error: `Cannot sell ${parsed.data.quantity} shares of ${parsed.data.symbol}. Only ${availableQuantity} shares available.`,
        });
      }
    }

    const transaction = await prisma.portfolioTransaction.create({
      data: {
        portfolioId: portfolio.id,
        symbol: parsed.data.symbol,
        type: parsed.data.type,
        quantity: parsed.data.quantity,
        price: parsed.data.price,
        notes: parsed.data.notes,
        executedAt: parsed.data.executedAt ? new Date(parsed.data.executedAt) : new Date(),
      },
    });

    res.json({ ok: true, transaction });
  });

  app.delete("/portfolios/:id/transactions/:transactionId", requireAuth, async (req, res) => {
    const portfolio = await getOwnedPortfolioOrNull(req.user.sub, req.params.id);
    if (!portfolio) return res.status(404).json({ error: "Portfolio not found" });

    const transaction = await prisma.portfolioTransaction.findFirst({
      where: {
        id: req.params.transactionId,
        portfolioId: portfolio.id,
      },
    });

    if (!transaction) {
      return res.status(404).json({ error: "Transaction not found" });
    }

    await prisma.portfolioTransaction.delete({
      where: { id: transaction.id },
    });

    res.json({ ok: true });
  });

  app.get("/portfolios/:id/summary", requireAuth, async (req, res) => {
    const portfolio = await prisma.portfolio.findFirst({
      where: { id: req.params.id, userId: req.user.sub },
      include: {
        transactions: true,
      },
    });

    if (!portfolio) return res.status(404).json({ error: "Portfolio not found" });

    const latestCloseMap = await buildLatestCloseMap(portfolio.transactions.map((transaction) => transaction.symbol));
    const { positions, realizedPnL } = derivePortfolioPositions(portfolio.transactions, latestCloseMap);

    const totalMarketValue = positions.reduce((sum, position) => sum + (position.marketValue || 0), 0);
    const totalCostBasis = positions.reduce((sum, position) => sum + (position.costBasis || 0), 0);
    const concentration = positions
      .filter((position) => position.marketValue !== null && totalMarketValue > 0)
      .map((position) => ({
        symbol: position.symbol,
        weightPct: Number(((position.marketValue / totalMarketValue) * 100).toFixed(2)),
        marketValue: position.marketValue,
      }))
      .sort((a, b) => b.weightPct - a.weightPct);

    res.json({
      ok: true,
      portfolio: {
        id: portfolio.id,
        name: portfolio.name,
      },
      summary: {
        totalMarketValue: Number(totalMarketValue.toFixed(2)),
        totalCostBasis: Number(totalCostBasis.toFixed(2)),
        unrealizedPnL: Number((totalMarketValue - totalCostBasis).toFixed(2)),
        realizedPnL,
        positionsCount: positions.length,
        transactionsCount: portfolio.transactions.length,
        concentration,
      },
    });
  });

  app.get("/analyses", requireAuth, async (req, res) => {
    const ticker = req.query.ticker ? String(req.query.ticker).trim().toUpperCase() : undefined;
    const watchlistId = req.query.watchlistId ? String(req.query.watchlistId).trim() : undefined;
    const portfolioId = req.query.portfolioId ? String(req.query.portfolioId).trim() : undefined;
    const take = Math.min(Math.max(Number(req.query.limit || 20), 1), 100);

    const analyses = await prisma.stockAnalysis.findMany({
      where: {
        userId: req.user.sub,
        ...(ticker ? { ticker: normalizeTicker(ticker) || ticker } : {}),
        ...(watchlistId ? { watchlistId } : {}),
        ...(portfolioId ? { portfolioId } : {}),
      },
      orderBy: { createdAt: "desc" },
      take,
    });

    res.json({ ok: true, analyses: analyses.map(toAnalysisResponse) });
  });

  app.get("/watchlists/:id/analyses", requireAuth, async (req, res) => {
    const watchlist = await getOwnedWatchlistOrNull(req.user.sub, req.params.id);
    if (!watchlist) return res.status(404).json({ error: "Watchlist not found" });

    const analyses = await prisma.stockAnalysis.findMany({
      where: {
        userId: req.user.sub,
        watchlistId: watchlist.id,
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    res.json({ ok: true, analyses: analyses.map(toAnalysisResponse) });
  });

  app.get("/portfolios/:id/analyses", requireAuth, async (req, res) => {
    const portfolio = await getOwnedPortfolioOrNull(req.user.sub, req.params.id);
    if (!portfolio) return res.status(404).json({ error: "Portfolio not found" });

    const analyses = await prisma.stockAnalysis.findMany({
      where: {
        userId: req.user.sub,
        portfolioId: portfolio.id,
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    res.json({ ok: true, analyses: analyses.map(toAnalysisResponse) });
  });

  app.get("/stocks/analyze", requireAuth, async (req, res) => {
    const parsed = analyzeQuerySchema.safeParse({
      ticker: String(req.query.ticker || ""),
      watchlistId: req.query.watchlistId ? String(req.query.watchlistId) : undefined,
      portfolioId: req.query.portfolioId ? String(req.query.portfolioId) : undefined,
    });
    if (!parsed.success) return res.status(400).json({ error: "Invalid analyze request" });

    const { ticker, watchlistId, portfolioId } = parsed.data;

    if (watchlistId) {
      const watchlist = await getOwnedWatchlistOrNull(req.user.sub, watchlistId);
      if (!watchlist) return res.status(404).json({ error: "Watchlist not found" });
    }

    if (portfolioId) {
      const portfolio = await getOwnedPortfolioOrNull(req.user.sub, portfolioId);
      if (!portfolio) return res.status(404).json({ error: "Portfolio not found" });
    }

    const twelveHoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000);
    const cached = await prisma.stockAnalysis.findFirst({
      where: {
        userId: req.user.sub,
        ticker,
        ...(watchlistId ? { watchlistId } : { watchlistId: null }),
        ...(portfolioId ? { portfolioId } : { portfolioId: null }),
        createdAt: { gte: twelveHoursAgo },
      },
      orderBy: { createdAt: "desc" },
    });

    if (cached) {
      return res.json({ ok: true, ...toAnalysisResponse({ ...cached, cached: true }) });
    }

    const dbRowsDesc = await prisma.dailyPrice.findMany({
      where: { symbol: ticker },
      orderBy: { date: "desc" },
      take: 120,
    });

    if (dbRowsDesc.length < 30) {
      return res.status(400).json({
        error: "Not enough historical data in DB, please run ingest job first",
      });
    }

    const dbRows = dbRowsDesc.slice().reverse();
    const mapped = dbRows.map((row) => ({
      date: row.date.toISOString().slice(0, 10),
      open: row.open ?? 0,
      high: row.high ?? 0,
      low: row.low ?? 0,
      close: row.close,
      volume: row.volume ? Number(row.volume) : 0,
    }));

    const stats = computeSimpleStats(mapped, 60);
    const last20 = mapped.slice(-20).map((row) => ({
      date: row.date,
      close: row.close,
      volume: row.volume,
    }));

    const prompt = { ticker, stats, last20 };
    const model = process.env.OPENAI_MODEL || "gpt-5-nano";

    const completion = await openai.chat.completions.create({
      model,
      messages: [
        {
          role: "system",
          content: "You are an analyst assistant. Provide neutral, educational stock commentary. No financial advice. Be concise.",
        },
        {
          role: "user",
          content:
            `Analyze this stock data and explain:\n` +
            `1) trend summary, 2) volatility/risk signals, 3) notable volume shifts, 4) what to watch next.\n\n` +
            `Return plain text with short bullet points.\n\nDATA:\n${JSON.stringify(prompt)}`,
        },
      ],
    });

    const summary = completion.choices?.[0]?.message?.content?.trim() || "No output.";
    const saved = await prisma.stockAnalysis.create({
      data: {
        userId: req.user.sub,
        ticker,
        summary,
        dataJson: prompt,
        cached: false,
        watchlistId: watchlistId || null,
        portfolioId: portfolioId || null,
      },
    });

    res.json({ ok: true, ...toAnalysisResponse(saved) });
  });

  app.get("/health", (req, res) => res.send("ok"));

  return app;
}
