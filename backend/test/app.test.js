import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";

function createPrismaMock() {
  return {
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    watchlist: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
    },
    watchlistItem: {
      create: vi.fn(),
      delete: vi.fn(),
    },
    portfolio: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
    },
    portfolioTransaction: {
      findMany: vi.fn(),
      create: vi.fn(),
      findFirst: vi.fn(),
      delete: vi.fn(),
    },
    stockAnalysis: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    dailyPrice: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
  };
}

function createTestApp(prisma) {
  return createApp({
    prisma,
    openai: {
      chat: {
        completions: {
          create: vi.fn(),
        },
      },
    },
    jwtSecret: "test-secret",
    frontendOrigin: "http://localhost:3000",
    nodeEnv: "test",
  });
}

describe("auth routes", () => {
  it("creates a user and sets a session cookie on signup", async () => {
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue({ id: "user_1", email: "user@example.com" });

    const app = createTestApp(prisma);
    const response = await request(app)
      .post("/auth/signup")
      .send({ email: "user@example.com", password: "password123" });

    expect(response.status).toBe(200);
    expect(response.body.user).toEqual({ id: "user_1", email: "user@example.com" });
    expect(response.headers["set-cookie"]).toBeDefined();
    expect(prisma.user.create).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid login credentials", async () => {
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(null);

    const app = createTestApp(prisma);
    const response = await request(app)
      .post("/auth/login")
      .send({ email: "missing@example.com", password: "wrong-password" });

    expect(response.status).toBe(401);
    expect(response.body.error).toBe("Invalid credentials");
  });
});

describe("portfolio transaction routes", () => {
  it("rejects selling more shares than currently owned", async () => {
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue({ id: "user_1", email: "seller@example.com" });
    prisma.portfolio.findFirst.mockResolvedValue({ id: "portfolio_1", userId: "user_1", name: "Main" });
    prisma.portfolioTransaction.findMany.mockResolvedValue([
      {
        id: "tx_1",
        portfolioId: "portfolio_1",
        symbol: "AVGO",
        type: "BUY",
        quantity: 2,
        price: 100,
        executedAt: "2026-03-01T00:00:00.000Z",
        createdAt: "2026-03-01T00:00:00.000Z",
      },
    ]);

    const app = createTestApp(prisma);
    const agent = request.agent(app);
    const signup = await agent
      .post("/auth/signup")
      .send({ email: "seller@example.com", password: "password123" });

    expect(signup.status).toBe(200);

    const response = await agent
      .post("/portfolios/portfolio_1/transactions")
      .send({ symbol: "AVGO", type: "SELL", quantity: 5, price: 120 });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain("Cannot sell 5 shares of AVGO");
    expect(prisma.portfolioTransaction.create).not.toHaveBeenCalled();
  });

  it("accepts a valid buy transaction", async () => {
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue({ id: "user_1", email: "buyer@example.com" });
    prisma.portfolio.findFirst.mockResolvedValue({ id: "portfolio_1", userId: "user_1", name: "Main" });
    prisma.portfolioTransaction.create.mockResolvedValue({
      id: "tx_2",
      portfolioId: "portfolio_1",
      symbol: "AVGO",
      type: "BUY",
      quantity: 3,
      price: 150,
    });

    const app = createTestApp(prisma);
    const agent = request.agent(app);
    const signup = await agent
      .post("/auth/signup")
      .send({ email: "buyer@example.com", password: "password123" });

    expect(signup.status).toBe(200);

    const response = await agent
      .post("/portfolios/portfolio_1/transactions")
      .send({ symbol: "AVGO", type: "BUY", quantity: 3, price: 150 });

    expect(response.status).toBe(200);
    expect(response.body.transaction.symbol).toBe("AVGO");
    expect(prisma.portfolioTransaction.create).toHaveBeenCalledTimes(1);
  });
});
