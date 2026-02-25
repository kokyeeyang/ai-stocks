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

// allow: https://<project>-<hash>-<team>-projects-<id>.vercel.app
const VERCEL_PREVIEW_REGEX =
  /^https:\/\/ai-stocks-.*\.vercel\.app$/;

app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true); // Postman / server-to-server

    const o = origin.replace(/\/$/, "");

    if (o === PROD_ORIGIN) return cb(null, true);
    if (VERCEL_PREVIEW_REGEX.test(o)) return cb(null, true);

    return cb(new Error(`CORS blocked: ${o}`));
  },
  credentials: true,
}));

app.options("*", cors()); // preflight

// app.use(
//   cors({
//     origin: process.env.FRONTEND_ORIGIN,
//     credentials: true
//   })
// );

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const jwtSecret = new TextEncoder().encode(process.env.JWT_SECRET);
const COOKIE_NAME = "session";

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
    req.user = payload; // { sub, email }
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
    // if frontend and backend are on different domains in prod, you must use sameSite:"none" + secure:true
    path: "/",
    maxAge: 7 * 24 * 60 * 60 * 1000
  });
}

/**
 * Auth routes
 */
app.post("/auth/signup", async (req, res) => {
  const schema = z.object({
    email: z.string().email(),
    password: z.string().min(8).max(72)
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { email, password } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return res.status(409).json({ error: "Email already in use" });

  const hash = await bcrypt.hash(password, 12);
  const user = await prisma.user.create({
    data: { email, password: hash },
    select: { id: true, email: true }
  });

  const token = await signSession({ sub: user.id, email: user.email });
  setSessionCookie(res, token);

  res.json({ ok: true, user });
});

app.post("/auth/login", async (req, res) => {
  const schema = z.object({
    email: z.string().email(),
    password: z.string().min(1).max(72)
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

/**
 * Cheap stock data: Stooq CSV (no API key)
 * Example: https://stooq.com/q/d/l/?s=aapl.us&i=d
 */
async function fetchStooqDaily(ticker) {
  const symbol = `${ticker.toLowerCase()}.us`;
  const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(symbol)}&i=d`;

  const resp = await fetch(url);
  if (!resp.ok) throw new Error("Failed to fetch price data");
  const csv = await resp.text();

  const lines = csv.trim().split("\n");
  if (lines.length < 3) throw new Error("No data for ticker");

  // Date,Open,High,Low,Close,Volume
  const rows = lines.slice(1).map((line) => {
    const [date, open, high, low, close, volume] = line.split(",");
    return {
      date,
      open: Number(open),
      high: Number(high),
      low: Number(low),
      close: Number(close),
      volume: Number(volume)
    };
  });

  return rows.filter((r) => Number.isFinite(r.close));
}

function computeSimpleStats(rows, days = 30) {
  const recent = rows.slice(-days);
  const first = recent[0];
  const last = recent[recent.length - 1];
  const changePct = first ? ((last.close - first.close) / first.close) * 100 : 0;

  const closes = recent.map((r) => r.close);
  const avgClose = closes.reduce((a, b) => a + b, 0) / Math.max(1, closes.length);

  // crude volatility proxy: avg absolute daily % move
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
    avgAbsDailyMovePct: Number(avgAbsDailyMovePct.toFixed(2))
  };
}

/**
 * Analysis endpoint with caching
 */
app.get("/stocks/analyze", requireAuth, async (req, res) => {
  const ticker = String(req.query.ticker || "").trim().toUpperCase();
  if (!/^[A-Z.]{1,10}$/.test(ticker)) {
    return res.status(400).json({ error: "Invalid ticker format" });
  }

  // Cache: return last analysis within 12 hours for this user+ticker
  const twelveHoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000);
  const cached = await prisma.stockAnalysis.findFirst({
    where: {
      userId: req.user.sub,
      ticker,
      createdAt: { gte: twelveHoursAgo }
    },
    orderBy: { createdAt: "desc" }
  });

  if (cached) {
    return res.json({ ok: true, cached: true, ticker, summary: cached.summary, data: cached.dataJson });
  }

  // const rows = await fetchStooqDaily(ticker);
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

  // Reverse into ascending chronological order for stats computations
  const dbRows = dbRowsDesc.slice().reverse();

  // Map into the same shape your existing stats code expects
  const mapped = dbRows.map((r) => ({
    date: r.date.toISOString().slice(0, 10),
    open: r.open ?? 0,
    high: r.high ?? 0,
    low: r.low ?? 0,
    close: r.close,
    // Neon/Prisma returns bigint -> convert for JSON safety
    volume: r.volume ? Number(r.volume) : 0,
  }));

  const stats = computeSimpleStats(mapped, 60);
  const last20 = mapped.slice(-20).map((r) => ({
    date: r.date,
    close: r.close,
    volume: r.volume,
  }));

  // Keep tokens low: send only distilled stats + last N closes
  // const last20 = rows.slice(-20).map((r) => ({ date: r.date, close: r.close, volume: r.volume }));

  const prompt = {
    ticker,
    stats,
    last20
  };

  const model = process.env.OPENAI_MODEL || "gpt-5-nano";

  const completion = await openai.chat.completions.create({
    model,
    messages: [
      {
        role: "system",
        content:
          "You are an analyst assistant. Provide neutral, educational stock commentary. No financial advice. Be concise."
      },
      {
        role: "user",
        content:
          `Analyze this stock data and explain:\n` +
          `1) trend summary, 2) volatility/risk signals, 3) notable volume shifts, 4) what to watch next.\n\n` +
          `Return plain text with short bullet points.\n\nDATA:\n${JSON.stringify(prompt)}`
      }
    ]
  });

  const summary = completion.choices?.[0]?.message?.content?.trim() || "No output.";

  const saved = await prisma.stockAnalysis.create({
    data: {
      userId: req.user.sub,
      ticker,
      summary,
      dataJson: prompt
    }
  });

  res.json({ ok: true, cached: false, ticker, summary: saved.summary, data: saved.dataJson });
});

app.get("/health", (req, res) => res.send("ok"));

app.listen(process.env.PORT || 4000, () => {
  console.log(`Backend running on http://localhost:${process.env.PORT || 4000}`);
});
