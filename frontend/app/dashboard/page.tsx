"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";

const API = process.env.NEXT_PUBLIC_API_BASE;

type User = {
  id: string;
  email: string;
};

type AnalysisResult = {
  id: string;
  cached: boolean;
  ticker: string;
  summary: string;
  data: unknown;
  news?: {
    articles: Array<{
      title: string;
      url: string;
      source: string;
      publishedAt: string | null;
      summary: string;
      sentimentScore: number;
      sentimentLabel: string;
      relevanceScore: number;
    }>;
    skipped: boolean;
    reason: string | null;
  } | null;
  newsSentiment?: {
    label: string;
    averageScore: number;
    articleCount: number;
    positiveCount: number;
    neutralCount: number;
    negativeCount: number;
  } | null;
  createdAt: string;
  watchlistId: string | null;
  portfolioId: string | null;
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

type PortfolioPosition = {
  symbol: string;
  quantity: number;
  averageCost: number;
  latestClose: number | null;
  marketValue: number | null;
  costBasis: number;
  unrealizedPnL: number | null;
  buyTransactions: number;
  sellTransactions: number;
};

type PortfolioTransaction = {
  id: string;
  type: "BUY" | "SELL";
  symbol: string;
  quantity: number;
  price: number;
  notes: string | null;
  executedAt: string;
};

type Portfolio = {
  id: string;
  name: string;
  positions: PortfolioPosition[];
  transactions: PortfolioTransaction[];
  summary?: {
    totalMarketValue: number;
    totalCostBasis: number;
    unrealizedPnL: number;
    realizedPnL: number;
  };
};

type DashboardPanel = "portfolios" | "analyses" | "transactions" | null;

function formatMoney(value: number | null | undefined) {
  if (value === null || value === undefined) return "--";
  return `$${value.toFixed(2)}`;
}

function formatSentimentLabel(value: string | null | undefined) {
  if (!value) return "No signal";
  return value.charAt(0).toUpperCase() + value.slice(1);
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
  const [recentAnalyses, setRecentAnalyses] = useState<AnalysisResult[]>([]);
  const [activePanel, setActivePanel] = useState<DashboardPanel>(null);

  const [newWatchlistName, setNewWatchlistName] = useState("");
  const [watchlistTickerInputs, setWatchlistTickerInputs] = useState<Record<string, string>>({});
  const [newPortfolioName, setNewPortfolioName] = useState("");
  const [portfolioTransactionInputs, setPortfolioTransactionInputs] = useState<
    Record<string, { symbol: string; quantity: string; price: string; type: "BUY" | "SELL" }>
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
      const [watchlistsResp, portfoliosResp, analysesResp] = await Promise.all([
        fetch(`${API}/watchlists`, { credentials: "include" }),
        fetch(`${API}/portfolios`, { credentials: "include" }),
        fetch(`${API}/analyses?limit=12`, { credentials: "include" }),
      ]);

      if (!watchlistsResp.ok || !portfoliosResp.ok || !analysesResp.ok) {
        throw new Error("Failed to load workspace");
      }

      const watchlistsData = await watchlistsResp.json();
      const portfoliosData = await portfoliosResp.json();
      const analysesData = await analysesResp.json();

      setWatchlists(watchlistsData.watchlists || []);
      setPortfolios(portfoliosData.portfolios || []);
      setRecentAnalyses(analysesData.analyses || []);
    } catch {
      setWorkspaceMsg("Failed to load portfolios and watchlists.");
    } finally {
      setWorkspaceLoading(false);
    }
  }

  async function analyze(options?: { ticker?: string; watchlistId?: string; portfolioId?: string }) {
    setMsg("");
    setResult(null);

    if (!API) {
      setMsg("App configuration error. Please try again later.");
      return;
    }

    const activeTicker = (options?.ticker || ticker).trim().toUpperCase();
    if (!activeTicker) {
      setMsg("Enter a valid ticker.");
      return;
    }

    setTicker(activeTicker);
    setLoading(true);
    try {
      const query = new URLSearchParams({ ticker: activeTicker });
      if (options?.watchlistId) query.set("watchlistId", options.watchlistId);
      if (options?.portfolioId) query.set("portfolioId", options.portfolioId);

      const resp = await fetch(`${API}/stocks/analyze?${query.toString()}`, {
        credentials: "include",
      });

      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        setMsg(data?.error || "Failed");
        return;
      }

      setResult(data);
      setMsg(data.cached ? "Loaded cached analysis (<=12h old)." : "Fresh analysis generated.");
      await loadWorkspace();
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

  async function addTransaction(portfolioId: string, e: FormEvent) {
    e.preventDefault();
    if (!API) return;

    const form = portfolioTransactionInputs[portfolioId] || {
      symbol: "",
      quantity: "",
      price: "",
      type: "BUY" as const,
    };
    const symbol = form.symbol.trim().toUpperCase();
    const quantity = Number(form.quantity);
    const price = Number(form.price);

    if (!symbol || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(price) || price <= 0) {
      setWorkspaceMsg("Enter a valid symbol, quantity, and price.");
      return;
    }

    setWorkspaceMsg("");
    const resp = await fetch(`${API}/portfolios/${portfolioId}/transactions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        symbol,
        type: form.type,
        quantity,
        price,
      }),
    });

    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      setWorkspaceMsg(data?.error || "Failed to add transaction.");
      return;
    }

    setPortfolioTransactionInputs((current) => ({
      ...current,
      [portfolioId]: { symbol: "", quantity: "", price: "", type: "BUY" },
    }));
    await loadWorkspace();
  }

  async function removeTransaction(portfolioId: string, transactionId: string) {
    if (!API) return;

    setWorkspaceMsg("");
    const resp = await fetch(`${API}/portfolios/${portfolioId}/transactions/${encodeURIComponent(transactionId)}`, {
      method: "DELETE",
      credentials: "include",
    });

    if (!resp.ok) {
      const data = await resp.json().catch(() => ({}));
      setWorkspaceMsg(data?.error || "Failed to remove transaction.");
      return;
    }

    await loadWorkspace();
  }

  if (checkingAuth) {
    return null;
  }

  const lastAnalysisByTicker = new Map<string, AnalysisResult>();
  for (const analysis of recentAnalyses) {
    if (!lastAnalysisByTicker.has(analysis.ticker)) {
      lastAnalysisByTicker.set(analysis.ticker, analysis);
    }
  }

  const recentTransactions = portfolios
    .flatMap((portfolio) =>
      portfolio.transactions.map((transaction) => ({
        ...transaction,
        portfolioId: portfolio.id,
        portfolioName: portfolio.name,
      }))
    )
    .sort((a, b) => new Date(b.executedAt).getTime() - new Date(a.executedAt).getTime());

  const portfolioTotals = portfolios.reduce(
    (totals, portfolio) => ({
      value: totals.value + (portfolio.summary?.totalMarketValue || 0),
      unrealized: totals.unrealized + (portfolio.summary?.unrealizedPnL || 0),
      realized: totals.realized + (portfolio.summary?.realizedPnL || 0),
    }),
    { value: 0, unrealized: 0, realized: 0 }
  );

  return (
    <div className="page">
      <div className="min-h-screen px-3 py-6 sm:px-5 lg:px-8 xl:px-10 2xl:px-12">
        <div className="mx-auto w-full max-w-[1800px]">
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

          <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)_340px]">
            <div className="space-y-6 xl:min-w-0">
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

                  <button onClick={() => analyze()} className="btn-primary w-full" disabled={loading} type="button">
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
                    <p className="mb-2 text-sm muted">Example tickers</p>
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
                                  onClick={() => analyze({ ticker: item.symbol, watchlistId: watchlist.id })}
                                >
                                  {item.symbol}
                                </button>
                                <span className="text-[10px] muted">
                                  {lastAnalysisByTicker.get(item.symbol)?.createdAt
                                    ? new Date(lastAnalysisByTicker.get(item.symbol)!.createdAt).toLocaleDateString()
                                    : "new"}
                                </span>
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

            </div>

            <div className="space-y-6">
              <div className="card card-pad">
                <h2 className="h2">News sentiment</h2>
                <p className="mt-1 text-sm muted">Recent headline tone for the selected ticker.</p>

                {!result ? (
                  <div className="mt-6 rounded-2xl border border-dashed p-4 text-sm muted">
                    Run an analysis to load recent news context.
                  </div>
                ) : result.newsSentiment ? (
                  <div className="mt-6 space-y-4">
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                      <div className="rounded-2xl border bg-black/10 p-4">
                        <p className="text-xs muted">Signal</p>
                        <p className="mt-1 text-sm text-white">{formatSentimentLabel(result.newsSentiment.label)}</p>
                      </div>
                      <div className="rounded-2xl border bg-black/10 p-4">
                        <p className="text-xs muted">Avg score</p>
                        <p className="mt-1 text-sm text-white">{result.newsSentiment.averageScore.toFixed(3)}</p>
                      </div>
                      <div className="rounded-2xl border bg-black/10 p-4">
                        <p className="text-xs muted">Articles</p>
                        <p className="mt-1 text-sm text-white">{result.newsSentiment.articleCount}</p>
                      </div>
                      <div className="rounded-2xl border bg-black/10 p-4">
                        <p className="text-xs muted">Pos / Neu / Neg</p>
                        <p className="mt-1 text-sm text-white">
                          {result.newsSentiment.positiveCount} / {result.newsSentiment.neutralCount} / {result.newsSentiment.negativeCount}
                        </p>
                      </div>
                    </div>

                    {(result.news?.articles || []).slice(0, 2).map((article, index) => (
                      <a
                        key={`${article.url}-${index}`}
                        href={article.url}
                        target="_blank"
                        rel="noreferrer"
                        className="block rounded-2xl border bg-black/10 p-4 hover:bg-white/5"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="badge">{formatSentimentLabel(article.sentimentLabel)}</span>
                          <span className="text-xs muted">{article.source}</span>
                        </div>
                        <p className="mt-3 text-sm text-white">{article.title}</p>
                      </a>
                    ))}
                  </div>
                ) : (
                  <div className="mt-6 rounded-2xl border border-dashed p-4 text-sm muted">
                    {result.news?.reason || "No recent news sentiment available for this ticker."}
                  </div>
                )}
              </div>

              <div className="card card-pad">
                <h2 className="h2">Workspace</h2>
                <p className="mt-1 text-sm muted">Open detail-heavy sections only when you need them.</p>

                {(workspaceMsg || workspaceLoading) && (
                  <div className="mt-4 rounded-xl border bg-white/5 px-4 py-3 text-sm muted">
                    {workspaceLoading ? "Refreshing workspace..." : workspaceMsg}
                  </div>
                )}

                <div className="mt-6 grid gap-3">
                  <div className="rounded-2xl border bg-black/10 p-4">
                    <p className="text-xs muted">Portfolios</p>
                    <p className="mt-1 text-sm text-white">{portfolios.length}</p>
                    <p className="mt-2 text-xs muted">
                      Value {formatMoney(portfolioTotals.value)} | Unrealized {formatMoney(portfolioTotals.unrealized)}
                    </p>
                    <button type="button" className="btn-ghost mt-4 w-full" onClick={() => setActivePanel("portfolios")}>
                      Open portfolios
                    </button>
                  </div>

                  <div className="rounded-2xl border bg-black/10 p-4">
                    <p className="text-xs muted">Recent analyses</p>
                    <p className="mt-1 text-sm text-white">{recentAnalyses.length}</p>
                    <p className="mt-2 text-xs muted">
                      Latest {recentAnalyses[0] ? new Date(recentAnalyses[0].createdAt).toLocaleString() : "none yet"}
                    </p>
                    <button type="button" className="btn-ghost mt-4 w-full" onClick={() => setActivePanel("analyses")}>
                      Open analyses
                    </button>
                  </div>

                  <div className="rounded-2xl border bg-black/10 p-4">
                    <p className="text-xs muted">Recent transactions</p>
                    <p className="mt-1 text-sm text-white">{recentTransactions.length}</p>
                    <p className="mt-2 text-xs muted">Realized {formatMoney(portfolioTotals.realized)}</p>
                    <button type="button" className="btn-ghost mt-4 w-full" onClick={() => setActivePanel("transactions")}>
                      Open transactions
                    </button>
                  </div>
                </div>

                <form className="mt-6 space-y-3" onSubmit={createPortfolio}>
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
              </div>
            </div>
          </div>

          <p className="mt-6 text-center text-xs muted">
            Educational-only content. Not financial advice.
          </p>
        </div>
      </div>

      {activePanel && (
        <div className="fixed inset-0 z-50 bg-black/50 p-3 sm:p-6" onClick={() => setActivePanel(null)}>
          <div
            className="ml-auto h-full w-full max-w-3xl overflow-y-auto rounded-3xl border bg-[rgb(var(--panel))] p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="h2">
                  {activePanel === "portfolios"
                    ? "Portfolios"
                    : activePanel === "analyses"
                      ? "Recent analyses"
                      : "Recent transactions"}
                </h2>
                <p className="mt-1 text-sm muted">
                  {activePanel === "portfolios"
                    ? "Manage positions and add transactions."
                    : activePanel === "analyses"
                      ? "Reopen prior analysis runs."
                      : "Review and remove recent portfolio transactions."}
                </p>
              </div>
              <button type="button" className="btn-ghost" onClick={() => setActivePanel(null)}>
                Close
              </button>
            </div>

            {activePanel === "portfolios" && (
              <div className="mt-6 space-y-4">
                {portfolios.length === 0 ? (
                  <div className="rounded-2xl border border-dashed p-4 text-sm muted">No portfolios yet.</div>
                ) : (
                  portfolios.map((portfolio) => (
                    <div key={portfolio.id} className="rounded-2xl border bg-black/10 p-5">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <p className="font-medium">{portfolio.name}</p>
                          <p className="text-xs muted">
                            {portfolio.positions.length} positions | {portfolio.transactions.length} transactions
                          </p>
                        </div>
                        <div className="grid grid-cols-2 gap-3 text-right text-xs muted sm:grid-cols-4">
                          <div>
                            <p>Value</p>
                            <p className="text-sm text-white">{formatMoney(portfolio.summary?.totalMarketValue)}</p>
                          </div>
                          <div>
                            <p>Cost</p>
                            <p className="text-sm text-white">{formatMoney(portfolio.summary?.totalCostBasis)}</p>
                          </div>
                          <div>
                            <p>Unrealized</p>
                            <p className="text-sm text-white">{formatMoney(portfolio.summary?.unrealizedPnL)}</p>
                          </div>
                          <div>
                            <p>Realized</p>
                            <p className="text-sm text-white">{formatMoney(portfolio.summary?.realizedPnL)}</p>
                          </div>
                        </div>
                      </div>

                      <form className="mt-4 grid gap-2 md:grid-cols-[110px_1fr_1fr_1fr_auto]" onSubmit={(e) => addTransaction(portfolio.id, e)}>
                        <select
                          className="input"
                          value={portfolioTransactionInputs[portfolio.id]?.type || "BUY"}
                          onChange={(e) =>
                            setPortfolioTransactionInputs((current) => ({
                              ...current,
                              [portfolio.id]: {
                                symbol: current[portfolio.id]?.symbol || "",
                                quantity: current[portfolio.id]?.quantity || "",
                                price: current[portfolio.id]?.price || "",
                                type: e.target.value as "BUY" | "SELL",
                              },
                            }))
                          }
                        >
                          <option value="BUY">Buy</option>
                          <option value="SELL">Sell</option>
                        </select>
                        <input
                          className="input"
                          value={portfolioTransactionInputs[portfolio.id]?.symbol || ""}
                          onChange={(e) =>
                            setPortfolioTransactionInputs((current) => ({
                              ...current,
                              [portfolio.id]: {
                                symbol: e.target.value.toUpperCase(),
                                quantity: current[portfolio.id]?.quantity || "",
                                price: current[portfolio.id]?.price || "",
                                type: current[portfolio.id]?.type || "BUY",
                              },
                            }))
                          }
                          placeholder="Ticker"
                        />
                        <input
                          className="input"
                          value={portfolioTransactionInputs[portfolio.id]?.quantity || ""}
                          onChange={(e) =>
                            setPortfolioTransactionInputs((current) => ({
                              ...current,
                              [portfolio.id]: {
                                symbol: current[portfolio.id]?.symbol || "",
                                quantity: e.target.value,
                                price: current[portfolio.id]?.price || "",
                                type: current[portfolio.id]?.type || "BUY",
                              },
                            }))
                          }
                          placeholder="Quantity"
                          inputMode="decimal"
                        />
                        <input
                          className="input"
                          value={portfolioTransactionInputs[portfolio.id]?.price || ""}
                          onChange={(e) =>
                            setPortfolioTransactionInputs((current) => ({
                              ...current,
                              [portfolio.id]: {
                                symbol: current[portfolio.id]?.symbol || "",
                                quantity: current[portfolio.id]?.quantity || "",
                                price: e.target.value,
                                type: current[portfolio.id]?.type || "BUY",
                              },
                            }))
                          }
                          placeholder="Price"
                          inputMode="decimal"
                        />
                        <button className="btn-ghost" type="submit">
                          Add txn
                        </button>
                      </form>

                      <div className="mt-4 space-y-3">
                        {portfolio.positions.length === 0 ? (
                          <div className="rounded-2xl border border-dashed p-4 text-sm muted">No positions yet.</div>
                        ) : (
                          portfolio.positions.map((position) => (
                            <div key={position.symbol} className="rounded-2xl border bg-white/5 p-4">
                              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                <div>
                                  <button
                                    type="button"
                                    className="font-medium hover:underline"
                                    onClick={() => analyze({ ticker: position.symbol, portfolioId: portfolio.id })}
                                  >
                                    {position.symbol}
                                  </button>
                                  <p className="text-xs muted">
                                    {position.quantity} shares at {formatMoney(position.averageCost)}
                                    {` | ${position.buyTransactions} buys / ${position.sellTransactions} sells`}
                                  </p>
                                </div>
                              </div>

                              <div className="mt-3 grid gap-3 sm:grid-cols-4 text-xs muted">
                                <div>
                                  <p>Last price</p>
                                  <p className="text-sm text-white">{formatMoney(position.latestClose)}</p>
                                </div>
                                <div>
                                  <p>Value</p>
                                  <p className="text-sm text-white">{formatMoney(position.marketValue)}</p>
                                </div>
                                <div>
                                  <p>Cost basis</p>
                                  <p className="text-sm text-white">{formatMoney(position.costBasis)}</p>
                                </div>
                                <div>
                                  <p>Unrealized P/L</p>
                                  <p className="text-sm text-white">{formatMoney(position.unrealizedPnL)}</p>
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
            )}

            {activePanel === "analyses" && (
              <div className="mt-6 space-y-3">
                {recentAnalyses.length === 0 ? (
                  <div className="rounded-2xl border border-dashed p-4 text-sm muted">No saved analyses yet.</div>
                ) : (
                  recentAnalyses.map((analysis) => (
                    <button
                      key={analysis.id}
                      type="button"
                      className="w-full rounded-2xl border bg-black/10 p-4 text-left hover:bg-white/5"
                      onClick={() => {
                        setTicker(analysis.ticker);
                        setResult(analysis);
                        setActivePanel(null);
                      }}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="badge">{analysis.ticker}</span>
                          <span className="badge muted">{analysis.cached ? "Cached" : "Fresh"}</span>
                        </div>
                        <span className="text-xs muted">{new Date(analysis.createdAt).toLocaleString()}</span>
                      </div>
                      <p className="mt-3 line-clamp-3 text-sm muted">{analysis.summary}</p>
                    </button>
                  ))
                )}
              </div>
            )}

            {activePanel === "transactions" && (
              <div className="mt-6 space-y-3">
                {recentTransactions.length === 0 ? (
                  <div className="rounded-2xl border border-dashed p-4 text-sm muted">No transactions yet.</div>
                ) : (
                  recentTransactions.map((transaction) => (
                    <div key={transaction.id} className="rounded-2xl border bg-black/10 p-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <p className="font-medium">
                            {transaction.type} {transaction.symbol}
                          </p>
                          <p className="text-xs muted">
                            {transaction.portfolioName} | {transaction.quantity} shares at {formatMoney(transaction.price)} |{" "}
                            {new Date(transaction.executedAt).toLocaleDateString()}
                          </p>
                        </div>
                        <button
                          type="button"
                          className="text-sm muted hover:text-white"
                          onClick={() => removeTransaction(transaction.portfolioId, transaction.id)}
                        >
                          Remove
                        </button>
                      </div>
                      {transaction.notes && <div className="mt-2 text-xs muted">{transaction.notes}</div>}
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
