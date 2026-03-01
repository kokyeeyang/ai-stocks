"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";

const API = process.env.NEXT_PUBLIC_API_BASE;

type User = {
  id: string;
  email: string;
};

type AnalysisResult = {
  cached: boolean;
  ticker: string;
  summary: string;
  data: unknown;
};

type WatchlistItem = {
  id: string;
  symbol: string;
  notes: string | null;
};

type Watchlist = {
  id: string;
  name: string;
  items: WatchlistItem[];
};

type PortfolioHolding = {
  id: string;
  symbol: string;
  quantity: number;
  averageCost: number | null;
  notes: string | null;
  latestClose: number | null;
  marketValue: number | null;
  costBasis: number | null;
  unrealizedPnL: number | null;
};

type Portfolio = {
  id: string;
  name: string;
  holdings: PortfolioHolding[];
  summary?: {
    totalMarketValue: number;
    totalCostBasis: number;
    unrealizedPnL: number;
  };
};

function formatMoney(value: number | null | undefined) {
  if (value === null || value === undefined) return "--";
  return `$${value.toFixed(2)}`;
}

export default function Dashboard() {
  const router = useRouter();
  const [me, setMe] = useState<User | null>(null);
  const [ticker, setTicker] = useState("AAPL");
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);

  const [watchlists, setWatchlists] = useState<Watchlist[]>([]);
  const [portfolios, setPortfolios] = useState<Portfolio[]>([]);
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [workspaceMsg, setWorkspaceMsg] = useState("");

  const [newWatchlistName, setNewWatchlistName] = useState("");
  const [watchlistTickerInputs, setWatchlistTickerInputs] = useState<Record<string, string>>({});
  const [newPortfolioName, setNewPortfolioName] = useState("");
  const [portfolioHoldingInputs, setPortfolioHoldingInputs] = useState<
    Record<string, { symbol: string; quantity: string; averageCost: string }>
  >({});

  useEffect(() => {
    if (!API) {
      setMsg("App configuration error. Please try again later.");
      setCheckingAuth(false);
      return;
    }

    fetch(`${API}/me`, { credentials: "include" })
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((data) => {
        setMe(data.user);
        setCheckingAuth(false);
      })
      .catch(() => router.replace("/login"));
  }, [router]);

  useEffect(() => {
    if (!API || checkingAuth || !me) return;
    void loadWorkspace();
  }, [checkingAuth, me]);

  async function loadWorkspace() {
    if (!API) return;

    setWorkspaceLoading(true);
    setWorkspaceMsg("");

    try {
      const [watchlistsResp, portfoliosResp] = await Promise.all([
        fetch(`${API}/watchlists`, { credentials: "include" }),
        fetch(`${API}/portfolios`, { credentials: "include" }),
      ]);

      if (!watchlistsResp.ok || !portfoliosResp.ok) {
        throw new Error("Failed to load workspace");
      }

      const watchlistsData = await watchlistsResp.json();
      const portfoliosData = await portfoliosResp.json();

      setWatchlists(watchlistsData.watchlists || []);
      setPortfolios(portfoliosData.portfolios || []);
    } catch {
      setWorkspaceMsg("Failed to load portfolios and watchlists.");
    } finally {
      setWorkspaceLoading(false);
    }
  }

  async function analyze() {
    setMsg("");
    setResult(null);

    if (!API) {
      setMsg("App configuration error. Please try again later.");
      return;
    }

    setLoading(true);
    try {
      const resp = await fetch(`${API}/stocks/analyze?ticker=${encodeURIComponent(ticker)}`, {
        credentials: "include",
      });

      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        setMsg(data?.error || "Failed");
        return;
      }

      setResult(data);
      setMsg(data.cached ? "Loaded cached analysis (<=12h old)." : "Fresh analysis generated.");
    } catch {
      setMsg("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function logout() {
    if (API) {
      await fetch(`${API}/auth/logout`, { method: "POST", credentials: "include" });
    }

    router.push("/login");
  }

  async function createWatchlist(e: FormEvent) {
    e.preventDefault();
    if (!API || !newWatchlistName.trim()) return;

    setWorkspaceMsg("");
    const resp = await fetch(`${API}/watchlists`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ name: newWatchlistName.trim() }),
    });

    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      setWorkspaceMsg(data?.error || "Failed to create watchlist.");
      return;
    }

    setNewWatchlistName("");
    await loadWorkspace();
  }

  async function addWatchlistItem(watchlistId: string, e: FormEvent) {
    e.preventDefault();
    if (!API) return;

    const symbol = (watchlistTickerInputs[watchlistId] || "").trim().toUpperCase();
    if (!symbol) return;

    setWorkspaceMsg("");
    const resp = await fetch(`${API}/watchlists/${watchlistId}/items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ symbol }),
    });

    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      setWorkspaceMsg(data?.error || "Failed to add ticker.");
      return;
    }

    setWatchlistTickerInputs((current) => ({ ...current, [watchlistId]: "" }));
    await loadWorkspace();
  }

  async function removeWatchlistItem(watchlistId: string, symbol: string) {
    if (!API) return;

    setWorkspaceMsg("");
    const resp = await fetch(`${API}/watchlists/${watchlistId}/items/${encodeURIComponent(symbol)}`, {
      method: "DELETE",
      credentials: "include",
    });

    if (!resp.ok) {
      const data = await resp.json().catch(() => ({}));
      setWorkspaceMsg(data?.error || "Failed to remove ticker.");
      return;
    }

    await loadWorkspace();
  }

  async function createPortfolio(e: FormEvent) {
    e.preventDefault();
    console.log('qweqeqweq');
    if (!API || !newPortfolioName.trim()) return;

    setWorkspaceMsg("");
    const resp = await fetch(`${API}/portfolios`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ name: newPortfolioName.trim() }),
    });

    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      setWorkspaceMsg(data?.error || "Failed to create portfolio.");
      return;
    }

    setNewPortfolioName("");
    await loadWorkspace();
  }

  async function addHolding(portfolioId: string, e: FormEvent) {
    e.preventDefault();
    if (!API) return;

    const form = portfolioHoldingInputs[portfolioId] || { symbol: "", quantity: "", averageCost: "" };
    const symbol = form.symbol.trim().toUpperCase();
    const quantity = Number(form.quantity);
    const averageCost = form.averageCost ? Number(form.averageCost) : undefined;

    if (!symbol || !Number.isFinite(quantity) || quantity <= 0) {
      setWorkspaceMsg("Enter a valid symbol and quantity.");
      return;
    }

    setWorkspaceMsg("");
    const resp = await fetch(`${API}/portfolios/${portfolioId}/holdings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        symbol,
        quantity,
        averageCost: averageCost !== undefined && Number.isFinite(averageCost) ? averageCost : undefined,
      }),
    });

    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      setWorkspaceMsg(data?.error || "Failed to add holding.");
      return;
    }

    setPortfolioHoldingInputs((current) => ({
      ...current,
      [portfolioId]: { symbol: "", quantity: "", averageCost: "" },
    }));
    await loadWorkspace();
  }

  async function removeHolding(portfolioId: string, symbol: string) {
    if (!API) return;

    setWorkspaceMsg("");
    const resp = await fetch(`${API}/portfolios/${portfolioId}/holdings/${encodeURIComponent(symbol)}`, {
      method: "DELETE",
      credentials: "include",
    });

    if (!resp.ok) {
      const data = await resp.json().catch(() => ({}));
      setWorkspaceMsg(data?.error || "Failed to remove holding.");
      return;
    }

    await loadWorkspace();
  }

  if (checkingAuth) {
    return null;
  }

  return (
    <div className="page">
      <div className="container-app flex min-h-screen items-center justify-center py-10">
        <div className="w-full max-w-6xl">
          <div className="mb-6 text-center">
            <div className="mx-auto mb-3 h-12 w-12 rounded-2xl bg-gradient-to-r from-[rgb(var(--accent))] to-[rgb(var(--accent2))]" />
            <h1 className="h1">Dashboard</h1>
            <p className="mt-1 muted">Analyze a ticker, track watchlists, and manage your portfolio.</p>
          </div>

          <div className="mb-6 flex flex-col gap-3 rounded-2xl border bg-black/10 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm muted">
              {me?.email ? `Signed in as ${me.email}` : "Loading account..."}
            </div>
            <button onClick={logout} className="btn-ghost" type="button">
              Logout
            </button>
          </div>

          <div className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
            <div className="space-y-6">
              <div className="card card-pad">
                <h2 className="h2">Analyze</h2>
                <p className="mt-1 muted text-sm">Quick commentary based on recent price and volume.</p>

                <div className="mt-4 space-y-4">
                  <div>
                    <label className="mb-2 block text-sm muted" htmlFor="ticker">
                      Ticker
                    </label>
                    <input
                      id="ticker"
                      className="input"
                      value={ticker}
                      onChange={(e) => setTicker(e.target.value.toUpperCase())}
                      placeholder="AAPL"
                    />
                  </div>

                  <button onClick={analyze} className="btn-primary w-full" disabled={loading} type="button">
                    {loading ? "Analyzing..." : "Analyze"}
                  </button>

                  {msg && (
                    <div
                      className={
                        msg.toLowerCase().includes("failed") || msg.toLowerCase().includes("error")
                          ? "rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm"
                          : "rounded-xl border bg-white/5 px-4 py-3 text-sm muted"
                      }
                    >
                      {msg}
                    </div>
                  )}

                  <div>
                    <p className="mb-2 text-sm muted">Popular tickers</p>
                    <div className="flex flex-wrap gap-2">
                      {["AAPL", "MSFT", "NVDA", "TSLA", "AMZN"].map((value) => (
                        <button
                          key={value}
                          type="button"
                          className="badge hover:bg-white/5"
                          onClick={() => setTicker(value)}
                        >
                          {value}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <div className="card card-pad">
                <h2 className="h2">Watchlists</h2>
                <p className="mt-1 text-sm muted">Save symbols you want to revisit quickly.</p>

                <form className="mt-4 space-y-3" onSubmit={createWatchlist}>
                  <input
                    className="input"
                    value={newWatchlistName}
                    onChange={(e) => setNewWatchlistName(e.target.value)}
                    placeholder="New watchlist name"
                  />
                  <button className="btn-primary w-full" type="submit">
                    Create watchlist
                  </button>
                </form>

                <div className="mt-6 space-y-4">
                  {watchlists.length === 0 ? (
                    <div className="rounded-2xl border border-dashed p-4 text-sm muted">
                      No watchlists yet.
                    </div>
                  ) : (
                    watchlists.map((watchlist) => (
                      <div key={watchlist.id} className="rounded-2xl border bg-black/10 p-4">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="font-medium">{watchlist.name}</p>
                            <p className="text-xs muted">{watchlist.items.length} saved tickers</p>
                          </div>
                        </div>

                        <form className="mt-3 flex gap-2" onSubmit={(e) => addWatchlistItem(watchlist.id, e)}>
                          <input
                            className="input"
                            value={watchlistTickerInputs[watchlist.id] || ""}
                            onChange={(e) =>
                              setWatchlistTickerInputs((current) => ({
                                ...current,
                                [watchlist.id]: e.target.value.toUpperCase(),
                              }))
                            }
                            placeholder="Add ticker"
                          />
                          <button className="btn-ghost" type="submit">
                            Add
                          </button>
                        </form>

                        <div className="mt-3 flex flex-wrap gap-2">
                          {watchlist.items.length === 0 ? (
                            <span className="text-xs muted">No tickers yet.</span>
                          ) : (
                            watchlist.items.map((item) => (
                              <div key={item.id} className="badge flex items-center gap-2">
                                <button
                                  type="button"
                                  className="hover:underline"
                                  onClick={() => setTicker(item.symbol)}
                                >
                                  {item.symbol}
                                </button>
                                <button
                                  type="button"
                                  className="text-xs muted hover:text-white"
                                  onClick={() => removeWatchlistItem(watchlist.id, item.symbol)}
                                >
                                  x
                                </button>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            <div className="space-y-6">
              <div className="card card-pad">
                <h2 className="h2">Latest result</h2>
                <p className="mt-1 muted text-sm">
                  {result?.cached ? "Cached result returned." : "Fresh result will appear here after analysis."}
                </p>

                {!result?.summary ? (
                  <div className="mt-6 rounded-2xl border border-dashed p-6 text-sm muted">
                    No analysis yet. Enter a ticker and click <span className="text-white">Analyze</span>.
                  </div>
                ) : (
                  <div className="mt-6 space-y-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="badge">Ticker: {result.ticker}</span>
                      <span className="badge muted">{result.cached ? "Cached" : "Fresh"}</span>
                    </div>

                    <div className="rounded-2xl border bg-black/10 p-5">
                      <pre className="whitespace-pre-wrap text-sm leading-6">{result.summary}</pre>
                    </div>

                    <details className="rounded-2xl border bg-black/10 p-5">
                      <summary className="cursor-pointer muted">Show input data</summary>
                      <pre className="mt-3 whitespace-pre-wrap text-xs muted">
                        {JSON.stringify(result.data, null, 2)}
                      </pre>
                    </details>
                  </div>
                )}
              </div>

              <div className="card card-pad">
                <h2 className="h2">Portfolios</h2>
                <p className="mt-1 text-sm muted">Track positions, cost basis, and current value.</p>

                <form className="mt-4 space-y-3" onSubmit={createPortfolio}>
                  <input
                    className="input"
                    value={newPortfolioName}
                    onChange={(e) => setNewPortfolioName(e.target.value)}
                    placeholder="New portfolio name"
                  />
                  <button className="btn-primary w-full" type="submit">
                    Create portfolio
                  </button>
                </form>

                {(workspaceMsg || workspaceLoading) && (
                  <div className="mt-4 rounded-xl border bg-white/5 px-4 py-3 text-sm muted">
                    {workspaceLoading ? "Refreshing workspace..." : workspaceMsg}
                  </div>
                )}

                <div className="mt-6 space-y-4">
                  {portfolios.length === 0 ? (
                    <div className="rounded-2xl border border-dashed p-4 text-sm muted">
                      No portfolios yet.
                    </div>
                  ) : (
                    portfolios.map((portfolio) => (
                      <div key={portfolio.id} className="rounded-2xl border bg-black/10 p-5">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div>
                            <p className="font-medium">{portfolio.name}</p>
                            <p className="text-xs muted">{portfolio.holdings.length} holdings</p>
                          </div>
                          <div className="grid grid-cols-3 gap-3 text-right text-xs muted">
                            <div>
                              <p>Value</p>
                              <p className="text-sm text-white">{formatMoney(portfolio.summary?.totalMarketValue)}</p>
                            </div>
                            <div>
                              <p>Cost</p>
                              <p className="text-sm text-white">{formatMoney(portfolio.summary?.totalCostBasis)}</p>
                            </div>
                            <div>
                              <p>P/L</p>
                              <p className="text-sm text-white">{formatMoney(portfolio.summary?.unrealizedPnL)}</p>
                            </div>
                          </div>
                        </div>

                        <form className="mt-4 grid gap-2 md:grid-cols-[1fr_1fr_1fr_auto]" onSubmit={(e) => addHolding(portfolio.id, e)}>
                          <input
                            className="input"
                            value={portfolioHoldingInputs[portfolio.id]?.symbol || ""}
                            onChange={(e) =>
                              setPortfolioHoldingInputs((current) => ({
                                ...current,
                                [portfolio.id]: {
                                  symbol: e.target.value.toUpperCase(),
                                  quantity: current[portfolio.id]?.quantity || "",
                                  averageCost: current[portfolio.id]?.averageCost || "",
                                },
                              }))
                            }
                            placeholder="Ticker"
                          />
                          <input
                            className="input"
                            value={portfolioHoldingInputs[portfolio.id]?.quantity || ""}
                            onChange={(e) =>
                              setPortfolioHoldingInputs((current) => ({
                                ...current,
                                [portfolio.id]: {
                                  symbol: current[portfolio.id]?.symbol || "",
                                  quantity: e.target.value,
                                  averageCost: current[portfolio.id]?.averageCost || "",
                                },
                              }))
                            }
                            placeholder="Quantity"
                            inputMode="decimal"
                          />
                          <input
                            className="input"
                            value={portfolioHoldingInputs[portfolio.id]?.averageCost || ""}
                            onChange={(e) =>
                              setPortfolioHoldingInputs((current) => ({
                                ...current,
                                [portfolio.id]: {
                                  symbol: current[portfolio.id]?.symbol || "",
                                  quantity: current[portfolio.id]?.quantity || "",
                                  averageCost: e.target.value,
                                },
                              }))
                            }
                            placeholder="Avg cost"
                            inputMode="decimal"
                          />
                          <button className="btn-ghost" type="submit">
                            Add
                          </button>
                        </form>

                        <div className="mt-4 space-y-3">
                          {portfolio.holdings.length === 0 ? (
                            <div className="rounded-2xl border border-dashed p-4 text-sm muted">
                              No holdings yet.
                            </div>
                          ) : (
                            portfolio.holdings.map((holding) => (
                              <div key={holding.id} className="rounded-2xl border bg-white/5 p-4">
                                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                  <div>
                                    <button
                                      type="button"
                                      className="font-medium hover:underline"
                                      onClick={() => setTicker(holding.symbol)}
                                    >
                                      {holding.symbol}
                                    </button>
                                    <p className="text-xs muted">
                                      {holding.quantity} shares at {formatMoney(holding.averageCost)}
                                    </p>
                                  </div>
                                  <button
                                    type="button"
                                    className="text-sm muted hover:text-white"
                                    onClick={() => removeHolding(portfolio.id, holding.symbol)}
                                  >
                                    Remove
                                  </button>
                                </div>

                                <div className="mt-3 grid gap-3 sm:grid-cols-4 text-xs muted">
                                  <div>
                                    <p>Last price</p>
                                    <p className="text-sm text-white">{formatMoney(holding.latestClose)}</p>
                                  </div>
                                  <div>
                                    <p>Value</p>
                                    <p className="text-sm text-white">{formatMoney(holding.marketValue)}</p>
                                  </div>
                                  <div>
                                    <p>Cost basis</p>
                                    <p className="text-sm text-white">{formatMoney(holding.costBasis)}</p>
                                  </div>
                                  <div>
                                    <p>Unrealized P/L</p>
                                    <p className="text-sm text-white">{formatMoney(holding.unrealizedPnL)}</p>
                                  </div>
                                </div>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>

          <p className="mt-6 text-center text-xs muted">
            Educational-only content. Not financial advice.
          </p>
        </div>
      </div>
    </div>
  );
}
