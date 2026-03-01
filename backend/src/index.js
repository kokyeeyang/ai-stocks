import "dotenv/config";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { z } from "zod";
import OpenAI from "openai";

const prisma = new PrismaClient();
const app = express();

app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());

const PROD_ORIGIN = (process.env.FRONTEND_ORIGIN || "").replace(/\/$/, "");
const VERCEL_PREVIEW_REGEX = /^https:\/\/ai-stocks-.*\.vercel\.app$/;
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const jwtSecret = new TextEncoder().encode(process.env.JWT_SECRET);
const COOKIE_NAME = "session";

const tickerSchema = z.string().trim().toUpperCase().regex(/^[A-Z.]{1,10}$/);
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
const portfolioHoldingSchema = z.object({
  symbol: tickerSchema,
  quantity: z.number().positive(),
  averageCost: z.number().positive().optional(),
  notes: z.string().trim().max(200).optional(),
});
const portfolioHoldingUpdateSchema = z.object({
  quantity: z.number().positive().optional(),
  averageCost: z.number().positive().nullable().optional(),
  notes: z.string().trim().max(200).nullable().optional(),
}).refine(
  (value) => value.quantity !== undefined || value.averageCost !== undefined || value.notes !== undefined,
  { message: "At least one field must be provided" }
);

app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);

    const normalizedOrigin = origin.replace(/\/$/, "");
    if (normalizedOrigin === PROD_ORIGIN) return cb(null, true);
    if (VERCEL_PREVIEW_REGEX.test(normalizedOrigin)) return cb(null, true);

    return cb(new Error(`CORS blocked: ${normalizedOrigin}`));
  },
  credentials: true,
}));

app.options("*", cors());

function isProd() {
  return process.env.NODE_ENV === "production";
}

async function signSession(payload) {
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(jwtSecret);
}

async function requireAuth(req, res, next) {
  try {
    const token = req.cookies[COOKIE_NAME];
    if (!token) return res.status(401).json({ error: "Not authenticated" });

    const { payload } = await jwtVerify(token, jwtSecret);
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

function normalizeHoldingForResponse(holding, latestCloseMap = new Map()) {
  const latestClose = latestCloseMap.get(holding.symbol) ?? null;
  const marketValue = latestClose !== null ? Number((holding.quantity * latestClose).toFixed(2)) : null;
  const costBasis = holding.averageCost !== null && holding.averageCost !== undefined
    ? Number((holding.quantity * holding.averageCost).toFixed(2))
    : null;
  const unrealizedPnL = marketValue !== null && costBasis !== null
    ? Number((marketValue - costBasis).toFixed(2))
    : null;

  return {
    ...holding,
    latestClose,
    marketValue,
    costBasis,
    unrealizedPnL,
  };
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
  console.log('here la!!!');
  const portfolios = await prisma.portfolio.findMany({
    where: { userId: req.user.sub },
    include: {
      holdings: {
        orderBy: { createdAt: "desc" },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const allSymbols = portfolios.flatMap((portfolio) => portfolio.holdings.map((holding) => holding.symbol));
  const latestCloseMap = await buildLatestCloseMap(allSymbols);

  const enrichedPortfolios = portfolios.map((portfolio) => {
    const holdings = portfolio.holdings.map((holding) => normalizeHoldingForResponse(holding, latestCloseMap));
    const totalMarketValue = holdings.reduce((sum, holding) => sum + (holding.marketValue || 0), 0);
    const totalCostBasis = holdings.reduce((sum, holding) => sum + (holding.costBasis || 0), 0);

    return {
      ...portfolio,
      holdings,
      summary: {
        totalMarketValue: Number(totalMarketValue.toFixed(2)),
        totalCostBasis: Number(totalCostBasis.toFixed(2)),
        unrealizedPnL: Number((totalMarketValue - totalCostBasis).toFixed(2)),
      },
    };
  });

  res.json({ ok: true, portfolios: enrichedPortfolios });
});

app.post("/portfolios", requireAuth, async (req, res) => {
  console.log('i am here!!!!');
  const parsed = portfolioSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const portfolio = await prisma.portfolio.create({
    data: {
      userId: req.user.sub,
      name: parsed.data.name,
    },
    include: { holdings: true },
  });

  res.json({ ok: true, portfolio });
});

app.post("/portfolios/:id/holdings", requireAuth, async (req, res) => {
  const parsed = portfolioHoldingSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const portfolio = await getOwnedPortfolioOrNull(req.user.sub, req.params.id);
  if (!portfolio) return res.status(404).json({ error: "Portfolio not found" });

  try {
    const holding = await prisma.portfolioHolding.create({
      data: {
        portfolioId: portfolio.id,
        symbol: parsed.data.symbol,
        quantity: parsed.data.quantity,
        averageCost: parsed.data.averageCost,
        notes: parsed.data.notes,
      },
    });

    res.json({ ok: true, holding });
  } catch (error) {
    if (error?.code === "P2002") {
      return res.status(409).json({ error: "Ticker already exists in this portfolio" });
    }
    throw error;
  }
});

app.patch("/portfolios/:id/holdings/:symbol", requireAuth, async (req, res) => {
  const parsed = portfolioHoldingUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const portfolio = await getOwnedPortfolioOrNull(req.user.sub, req.params.id);
  if (!portfolio) return res.status(404).json({ error: "Portfolio not found" });

  const symbol = String(req.params.symbol || "").trim().toUpperCase();
  const holding = await prisma.portfolioHolding.findUnique({
    where: {
      portfolioId_symbol: {
        portfolioId: portfolio.id,
        symbol,
      },
    },
  });

  if (!holding) return res.status(404).json({ error: "Holding not found" });

  const updated = await prisma.portfolioHolding.update({
    where: {
      portfolioId_symbol: {
        portfolioId: portfolio.id,
        symbol,
      },
    },
    data: {
      quantity: parsed.data.quantity ?? holding.quantity,
      averageCost: parsed.data.averageCost === undefined ? holding.averageCost : parsed.data.averageCost,
      notes: parsed.data.notes === undefined ? holding.notes : parsed.data.notes,
    },
  });

  res.json({ ok: true, holding: updated });
});

app.delete("/portfolios/:id/holdings/:symbol", requireAuth, async (req, res) => {
  const portfolio = await getOwnedPortfolioOrNull(req.user.sub, req.params.id);
  if (!portfolio) return res.status(404).json({ error: "Portfolio not found" });

  await prisma.portfolioHolding.delete({
    where: {
      portfolioId_symbol: {
        portfolioId: portfolio.id,
        symbol: String(req.params.symbol || "").trim().toUpperCase(),
      },
    },
  }).catch(() => null);

  res.json({ ok: true });
});

app.get("/portfolios/:id/summary", requireAuth, async (req, res) => {
  const portfolio = await prisma.portfolio.findFirst({
    where: { id: req.params.id, userId: req.user.sub },
    include: {
      holdings: true,
    },
  });

  if (!portfolio) return res.status(404).json({ error: "Portfolio not found" });

  const latestCloseMap = await buildLatestCloseMap(portfolio.holdings.map((holding) => holding.symbol));
  const holdings = portfolio.holdings.map((holding) => normalizeHoldingForResponse(holding, latestCloseMap));

  const totalMarketValue = holdings.reduce((sum, holding) => sum + (holding.marketValue || 0), 0);
  const totalCostBasis = holdings.reduce((sum, holding) => sum + (holding.costBasis || 0), 0);
  const concentration = holdings
    .filter((holding) => holding.marketValue !== null && totalMarketValue > 0)
    .map((holding) => ({
      symbol: holding.symbol,
      weightPct: Number(((holding.marketValue / totalMarketValue) * 100).toFixed(2)),
      marketValue: holding.marketValue,
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
      holdingsCount: holdings.length,
      concentration,
    },
  });
});

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

app.get("/stocks/analyze", requireAuth, async (req, res) => {
  const ticker = String(req.query.ticker || "").trim().toUpperCase();
  if (!/^[A-Z.]{1,10}$/.test(ticker)) {
    return res.status(400).json({ error: "Invalid ticker format" });
  }

  const twelveHoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000);
  const cached = await prisma.stockAnalysis.findFirst({
    where: {
      userId: req.user.sub,
      ticker,
      createdAt: { gte: twelveHoursAgo },
    },
    orderBy: { createdAt: "desc" },
  });

  if (cached) {
    return res.json({ ok: true, cached: true, ticker, summary: cached.summary, data: cached.dataJson });
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
    },
  });

  res.json({ ok: true, cached: false, ticker, summary: saved.summary, data: saved.dataJson });
});

app.get("/health", (req, res) => res.send("ok"));

app.listen(process.env.PORT || 4000, () => {
  console.log(`Backend running on http://localhost:${process.env.PORT || 4000}`);
});
