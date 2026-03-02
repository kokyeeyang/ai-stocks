import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { z } from "zod";
import { fetchTickerNewsSentiment } from "./news.js";
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

function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function calculateSMA(values, period) {
  if (values.length < period) return null;
  return average(values.slice(-period));
}

function calculateEMA(values, period) {
  if (values.length < period) return null;
  const multiplier = 2 / (period + 1);
  let ema = average(values.slice(0, period));

  for (let index = period; index < values.length; index += 1) {
    ema = (values[index] - ema) * multiplier + ema;
  }

  return ema;
}

function calculateRSI(values, period = 14) {
  if (values.length <= period) return null;

  let gains = 0;
  let losses = 0;
  for (let index = 1; index <= period; index += 1) {
    const delta = values[index] - values[index - 1];
    if (delta >= 0) gains += delta;
    else losses += Math.abs(delta);
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let index = period + 1; index < values.length; index += 1) {
    const delta = values[index] - values[index - 1];
    const gain = delta > 0 ? delta : 0;
    const loss = delta < 0 ? Math.abs(delta) : 0;

    avgGain = ((avgGain * (period - 1)) + gain) / period;
    avgLoss = ((avgLoss * (period - 1)) + loss) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

function calculateReturn(closes, periodsAgo) {
  if (closes.length <= periodsAgo) return null;
  const start = closes[closes.length - 1 - periodsAgo];
  const end = closes[closes.length - 1];
  if (!start) return null;
  return ((end - start) / start) * 100;
}

function computeTechnicalIndicators(rows) {
  const closes = rows.map((row) => row.close);
  const volumes = rows.map((row) => row.volume || 0);
  const latestClose = closes[closes.length - 1] ?? null;
  const sma20 = calculateSMA(closes, 20);
  const sma50 = calculateSMA(closes, 50);
  const ema12 = calculateEMA(closes, 12);
  const ema26 = calculateEMA(closes, 26);
  const macd = ema12 !== null && ema26 !== null ? ema12 - ema26 : null;
  const macdSignalSeriesBase = closes.slice(-80);
  const macdSignal = macdSignalSeriesBase.length >= 35
    ? (() => {
        const series = [];
        for (let index = 26; index < macdSignalSeriesBase.length; index += 1) {
          const slice = macdSignalSeriesBase.slice(0, index + 1);
          const fast = calculateEMA(slice, 12);
          const slow = calculateEMA(slice, 26);
          if (fast !== null && slow !== null) series.push(fast - slow);
        }
        return calculateEMA(series, 9);
      })()
    : null;
  const rsi14 = calculateRSI(closes, 14);
  const trailing252 = rows.slice(-252);
  const trailingHigh = trailing252.length ? Math.max(...trailing252.map((row) => row.high || row.close)) : null;
  const trailingLow = trailing252.length ? Math.min(...trailing252.map((row) => row.low || row.close)) : null;
  const averageVolume20 = calculateSMA(volumes, 20);
  const latestVolume = volumes[volumes.length - 1] ?? null;
  const oneDayReturn = calculateReturn(closes, 1);
  const oneWeekReturn = calculateReturn(closes, 5);
  const oneMonthReturn = calculateReturn(closes, 21);

  const trendLabel =
    latestClose !== null && sma20 !== null && sma50 !== null
      ? latestClose > sma20 && sma20 > sma50
        ? "bullish"
        : latestClose < sma20 && sma20 < sma50
          ? "bearish"
          : "mixed"
      : "mixed";

  const momentumLabel =
    rsi14 === null ? "unknown" : rsi14 >= 70 ? "overbought" : rsi14 <= 30 ? "oversold" : "balanced";

  const volatilityLabel =
    rows.length < 20
      ? "unknown"
      : (() => {
          const recentMoves = [];
          for (let index = Math.max(1, rows.length - 20); index < rows.length; index += 1) {
            recentMoves.push(Math.abs(((rows[index].close - rows[index - 1].close) / rows[index - 1].close) * 100));
          }
          const avgMove = average(recentMoves);
          if (avgMove >= 3) return "high";
          if (avgMove >= 1.5) return "medium";
          return "low";
        })();

  return {
    latestClose: latestClose !== null ? Number(latestClose.toFixed(2)) : null,
    sma20: sma20 !== null ? Number(sma20.toFixed(2)) : null,
    sma50: sma50 !== null ? Number(sma50.toFixed(2)) : null,
    rsi14: rsi14 !== null ? Number(rsi14.toFixed(2)) : null,
    macd: macd !== null ? Number(macd.toFixed(3)) : null,
    macdSignal: macdSignal !== null ? Number(macdSignal.toFixed(3)) : null,
    trailing52WeekHigh: trailingHigh !== null ? Number(trailingHigh.toFixed(2)) : null,
    trailing52WeekLow: trailingLow !== null ? Number(trailingLow.toFixed(2)) : null,
    averageVolume20: averageVolume20 !== null ? Math.round(averageVolume20) : null,
    latestVolume: latestVolume !== null ? Math.round(latestVolume) : null,
    returns: {
      day1: oneDayReturn !== null ? Number(oneDayReturn.toFixed(2)) : null,
      week1: oneWeekReturn !== null ? Number(oneWeekReturn.toFixed(2)) : null,
      month1: oneMonthReturn !== null ? Number(oneMonthReturn.toFixed(2)) : null,
    },
    labels: {
      trend: trendLabel,
      momentum: momentumLabel,
      volatility: volatilityLabel,
    },
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

  async function buildLatestAnalysisMap(userId, watchlistIds = []) {
    if (!watchlistIds.length) return new Map();

    const analyses = await prisma.stockAnalysis.findMany({
      where: {
        userId,
        watchlistId: { in: watchlistIds },
      },
      orderBy: { createdAt: "desc" },
      take: 500,
    });

    const latestMap = new Map();
    for (const analysis of analyses) {
      const key = `${analysis.watchlistId}:${analysis.ticker}`;
      if (!latestMap.has(key)) {
        latestMap.set(key, analysis);
      }
    }

    return latestMap;
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
    const data = analysis.dataJson || {};

    return {
      id: analysis.id,
      ticker: analysis.ticker,
      summary: analysis.summary,
      data,
      indicators: data.indicators || null,
      chartSeries: data.chartSeries || [],
      news: data.news || null,
      newsSentiment: data.newsSentiment || null,
      cached: analysis.cached,
      createdAt: analysis.createdAt,
      watchlistId: analysis.watchlistId,
      portfolioId: analysis.portfolioId,
    };
  }

  function hasCompleteAnalysisData(analysis) {
    const data = analysis?.dataJson || {};
    return Boolean(
      data &&
      data.indicators &&
      Array.isArray(data.chartSeries) &&
      data.chartSeries.length > 0
    );
  }

  function parsePage(value, defaultValue = 1) {
    return Math.max(Number(value || defaultValue) || defaultValue, 1);
  }

  function parseLimit(value, defaultValue, maxValue = 100) {
    return Math.min(Math.max(Number(value || defaultValue) || defaultValue, 1), maxValue);
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

    const symbols = watchlists.flatMap((watchlist) => watchlist.items.map((item) => item.symbol));
    const latestCloseMap = await buildLatestCloseMap(symbols);
    const latestAnalysisMap = await buildLatestAnalysisMap(req.user.sub, watchlists.map((watchlist) => watchlist.id));

    const enrichedWatchlists = watchlists.map((watchlist) => ({
      ...watchlist,
      items: watchlist.items.map((item) => {
        const latestAnalysis = latestAnalysisMap.get(`${watchlist.id}:${item.symbol}`) || null;
        return {
          ...item,
          latestClose: latestCloseMap.get(item.symbol) ?? null,
          latestAnalysis: latestAnalysis
            ? {
                id: latestAnalysis.id,
                createdAt: latestAnalysis.createdAt,
                summary: latestAnalysis.summary,
                cached: latestAnalysis.cached,
              }
            : null,
        };
      }),
    }));

    res.json({ ok: true, watchlists: enrichedWatchlists });
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
    const q = req.query.q ? String(req.query.q).trim() : "";
    const context = req.query.context ? String(req.query.context).trim().toLowerCase() : "all";
    const page = parsePage(req.query.page, 1);
    const take = parseLimit(req.query.limit, 20, 100);
    const skip = (page - 1) * take;
    const where = {
      userId: req.user.sub,
      ...(ticker ? { ticker: normalizeTicker(ticker) || ticker } : {}),
      ...(watchlistId ? { watchlistId } : {}),
      ...(portfolioId ? { portfolioId } : {}),
      ...(q
        ? {
            OR: [
              { ticker: { contains: q.toUpperCase() } },
              { summary: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
      ...(context === "watchlist"
        ? { watchlistId: { not: null } }
        : context === "portfolio"
          ? { portfolioId: { not: null } }
          : context === "direct"
            ? { watchlistId: null, portfolioId: null }
            : {}),
    };

    const [analyses, total] = await Promise.all([
      prisma.stockAnalysis.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take,
      skip,
    }),
      prisma.stockAnalysis.count({ where }),
    ]);

    res.json({
      ok: true,
      analyses: analyses.map(toAnalysisResponse),
      pagination: {
        page,
        limit: take,
        total,
        totalPages: Math.max(Math.ceil(total / take), 1),
      },
    });
  });

  app.get("/transactions", requireAuth, async (req, res) => {
    const q = req.query.q ? String(req.query.q).trim() : "";
    const type = req.query.type ? String(req.query.type).trim().toUpperCase() : "ALL";
    const portfolioId = req.query.portfolioId ? String(req.query.portfolioId).trim() : "";
    const page = parsePage(req.query.page, 1);
    const take = parseLimit(req.query.limit, 8, 50);
    const skip = (page - 1) * take;

    const where = {
      portfolio: {
        is: {
          userId: req.user.sub,
          ...(portfolioId ? { id: portfolioId } : {}),
        },
      },
      ...(type === "BUY" || type === "SELL" ? { type } : {}),
      ...(q
        ? {
            OR: [
              { symbol: { contains: q.toUpperCase() } },
              { notes: { contains: q, mode: "insensitive" } },
              {
                portfolio: {
                  is: {
                    userId: req.user.sub,
                    ...(portfolioId ? { id: portfolioId } : {}),
                    name: { contains: q, mode: "insensitive" },
                  },
                },
              },
            ],
          }
        : {}),
    };

    const [transactions, total] = await Promise.all([
      prisma.portfolioTransaction.findMany({
        where,
        include: {
          portfolio: {
            select: { id: true, name: true },
          },
        },
        orderBy: [{ executedAt: "desc" }, { createdAt: "desc" }],
        take,
        skip,
      }),
      prisma.portfolioTransaction.count({ where }),
    ]);

    res.json({
      ok: true,
      transactions: transactions.map((transaction) => ({
        id: transaction.id,
        type: transaction.type,
        symbol: transaction.symbol,
        quantity: transaction.quantity,
        price: transaction.price,
        notes: transaction.notes,
        executedAt: transaction.executedAt,
        portfolioId: transaction.portfolio.id,
        portfolioName: transaction.portfolio.name,
      })),
      pagination: {
        page,
        limit: take,
        total,
        totalPages: Math.max(Math.ceil(total / take), 1),
      },
    });
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

    if (cached && hasCompleteAnalysisData(cached)) {
      return res.json({ ok: true, ...toAnalysisResponse({ ...cached, cached: true }) });
    }

    const dbRowsDesc = await prisma.dailyPrice.findMany({
      where: { symbol: ticker },
      orderBy: { date: "desc" },
      take: 260,
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
    const indicators = computeTechnicalIndicators(mapped);
    const last20 = mapped.slice(-20).map((row) => ({
      date: row.date,
      close: row.close,
      volume: row.volume,
    }));
    const chartSeries = mapped.slice(-60).map((row) => ({
      date: row.date,
      close: row.close,
      volume: row.volume,
    }));

    let newsBundle = {
      articles: [],
      aggregate: null,
      skipped: true,
      reason: "ALPHA_VANTAGE_API_KEY is not configured",
    };

    try {
      newsBundle = await fetchTickerNewsSentiment(ticker, process.env.ALPHA_VANTAGE_API_KEY, 6);
    } catch (error) {
      newsBundle = {
        articles: [],
        aggregate: null,
        skipped: true,
        reason: error?.message || "Failed to fetch news",
      };
    }

    const prompt = {
      ticker,
      stats,
      indicators,
      last20,
      chartSeries,
      newsSentiment: newsBundle.aggregate,
      newsHeadlines: newsBundle.articles.map((article) => ({
        title: article.title,
        source: article.source,
        publishedAt: article.publishedAt,
        sentimentLabel: article.sentimentLabel,
        sentimentScore: article.sentimentScore,
      })),
    };
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
            `1) trend summary, 2) technical indicator context, 3) volatility/risk signals, 4) notable volume shifts, 5) news sentiment context, 6) what to watch next.\n\n` +
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
        dataJson: {
          ...prompt,
          news: {
            articles: newsBundle.articles,
            skipped: newsBundle.skipped,
            reason: newsBundle.reason,
          },
        },
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
