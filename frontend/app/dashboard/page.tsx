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
  indicators?: {
    latestClose: number | null;
    sma20: number | null;
    sma50: number | null;
    rsi14: number | null;
    macd: number | null;
    macdSignal: number | null;
    trailing52WeekHigh: number | null;
    trailing52WeekLow: number | null;
    averageVolume20: number | null;
    latestVolume: number | null;
    returns: {
      day1: number | null;
      week1: number | null;
      month1: number | null;
    };
    labels: {
      trend: string;
      momentum: string;
      volatility: string;
    };
  } | null;
  chartSeries?: Array<{
    date: string;
    close: number;
    volume: number;
  }>;
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
  latestClose?: number | null;
  latestAnalysis?: {
    id: string;
    createdAt: string;
    summary: string;
    cached: boolean;
  } | null;
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
type PaginationState = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};
type PanelTransaction = {
  id: string;
  type: "BUY" | "SELL";
  symbol: string;
  quantity: number;
  price: number;
  notes: string | null;
  executedAt: string;
  portfolioId: string;
  portfolioName: string;
};

function formatMoney(value: number | null | undefined) {
  if (value === null || value === undefined) return "--";
  return `$${value.toFixed(2)}`;
}

function formatSentimentLabel(value: string | null | undefined) {
  if (!value) return "No signal";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatCompactNumber(value: number | null | undefined) {
  if (value === null || value === undefined) return "--";
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function formatSignedPercent(value: number | null | undefined) {
  if (value === null || value === undefined) return "--";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function buildLinePath(values: number[], width: number, height: number) {
  if (!values.length) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  return values
    .map((value, index) => {
      const x = (index / Math.max(1, values.length - 1)) * width;
      const y = height - ((value - min) / range) * height;
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
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
  const [recentTransactions, setRecentTransactions] = useState<PanelTransaction[]>([]);
  const [recentAnalysesTotal, setRecentAnalysesTotal] = useState(0);
  const [recentTransactionsTotal, setRecentTransactionsTotal] = useState(0);
  const [analysisPanelItems, setAnalysisPanelItems] = useState<AnalysisResult[]>([]);
  const [transactionPanelItems, setTransactionPanelItems] = useState<PanelTransaction[]>([]);
  const [analysisPagination, setAnalysisPagination] = useState<PaginationState>({ page: 1, limit: 6, total: 0, totalPages: 1 });
  const [transactionPagination, setTransactionPagination] = useState<PaginationState>({ page: 1, limit: 8, total: 0, totalPages: 1 });
  const [analysisSearch, setAnalysisSearch] = useState("");
  const [analysisSearchDraft, setAnalysisSearchDraft] = useState("");
  const [analysisContextFilter, setAnalysisContextFilter] = useState("all");
  const [transactionSearch, setTransactionSearch] = useState("");
  const [transactionSearchDraft, setTransactionSearchDraft] = useState("");
  const [transactionTypeFilter, setTransactionTypeFilter] = useState("all");
  const [transactionPortfolioFilter, setTransactionPortfolioFilter] = useState("all");
  const [analysesLoading, setAnalysesLoading] = useState(false);
  const [transactionsLoading, setTransactionsLoading] = useState(false);
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

  useEffect(() => {
    if (activePanel === "analyses") {
      void loadAnalysesPage(analysisPagination.page);
    }
  }, [activePanel, analysisPagination.page, analysisSearch, analysisContextFilter]);

  useEffect(() => {
    if (activePanel === "transactions") {
      void loadTransactionsPage(transactionPagination.page);
    }
  }, [activePanel, transactionPagination.page, transactionSearch, transactionTypeFilter, transactionPortfolioFilter]);

  async function loadWorkspace() {
    if (!API) return;

    setWorkspaceLoading(true);
    setWorkspaceMsg("");

    try {
      const [watchlistsResp, portfoliosResp, analysesResp, transactionsResp] = await Promise.all([
        fetch(`${API}/watchlists`, { credentials: "include" }),
        fetch(`${API}/portfolios`, { credentials: "include" }),
        fetch(`${API}/analyses?limit=6&page=1`, { credentials: "include" }),
        fetch(`${API}/transactions?limit=8&page=1`, { credentials: "include" }),
      ]);

      if (!watchlistsResp.ok || !portfoliosResp.ok || !analysesResp.ok || !transactionsResp.ok) {
        throw new Error("Failed to load workspace");
      }

      const watchlistsData = await watchlistsResp.json();
      const portfoliosData = await portfoliosResp.json();
      const analysesData = await analysesResp.json();
      const transactionsData = await transactionsResp.json();

      setWatchlists(watchlistsData.watchlists || []);
      setPortfolios(portfoliosData.portfolios || []);
      setRecentAnalyses(analysesData.analyses || []);
      setRecentTransactions(transactionsData.transactions || []);
      setRecentAnalysesTotal(analysesData.pagination?.total || 0);
      setRecentTransactionsTotal(transactionsData.pagination?.total || 0);
      setAnalysisPagination(analysesData.pagination || { page: 1, limit: 6, total: 0, totalPages: 1 });
      setTransactionPagination(transactionsData.pagination || { page: 1, limit: 8, total: 0, totalPages: 1 });
    } catch {
      setWorkspaceMsg("Failed to load portfolios and watchlists.");
    } finally {
      setWorkspaceLoading(false);
    }
  }

  async function loadAnalysesPage(page = 1) {
    if (!API) return;
    setAnalysesLoading(true);

    try {
      const query = new URLSearchParams({
        page: String(page),
        limit: "6",
      });
      if (analysisSearch) query.set("q", analysisSearch);
      if (analysisContextFilter !== "all") query.set("context", analysisContextFilter);

      const resp = await fetch(`${API}/analyses?${query.toString()}`, { credentials: "include" });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        setWorkspaceMsg(data?.error || "Failed to load analyses.");
        return;
      }

      setAnalysisPanelItems(data.analyses || []);
      setAnalysisPagination(data.pagination || { page, limit: 6, total: 0, totalPages: 1 });
    } finally {
      setAnalysesLoading(false);
    }
  }

  async function loadTransactionsPage(page = 1) {
    if (!API) return;
    setTransactionsLoading(true);

    try {
      const query = new URLSearchParams({
        page: String(page),
        limit: "8",
      });
      if (transactionSearch) query.set("q", transactionSearch);
      if (transactionTypeFilter !== "all") query.set("type", transactionTypeFilter);
      if (transactionPortfolioFilter !== "all") query.set("portfolioId", transactionPortfolioFilter);

      const resp = await fetch(`${API}/transactions?${query.toString()}`, { credentials: "include" });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        setWorkspaceMsg(data?.error || "Failed to load transactions.");
        return;
      }

      setTransactionPanelItems(data.transactions || []);
      setTransactionPagination(data.pagination || { page, limit: 8, total: 0, totalPages: 1 });
    } finally {
      setTransactionsLoading(false);
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
      if (activePanel === "analyses") {
        await loadAnalysesPage(analysisPagination.page);
      }
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

  async function analyzeWatchlist(watchlist: Watchlist) {
    if (!watchlist.items.length) {
      setWorkspaceMsg("Add at least one ticker before analyzing a watchlist.");
      return;
    }

    setWorkspaceMsg("");
    for (const item of watchlist.items) {
      // Sequential keeps the UI/state predictable and avoids a burst of API requests.
      // The latest item analyzed will remain in the main result panel.
      // eslint-disable-next-line no-await-in-loop
      await analyze({ ticker: item.symbol, watchlistId: watchlist.id });
    }
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
    if (activePanel === "transactions") {
      await loadTransactionsPage(transactionPagination.page);
    }
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
    if (activePanel === "transactions") {
      await loadTransactionsPage(transactionPagination.page);
    }
  }

  if (checkingAuth) {
    return null;
  }

  const portfolioTotals = portfolios.reduce(
    (totals, portfolio) => ({
      value: totals.value + (portfolio.summary?.totalMarketValue || 0),
      unrealized: totals.unrealized + (portfolio.summary?.unrealizedPnL || 0),
      realized: totals.realized + (portfolio.summary?.realizedPnL || 0),
    }),
    { value: 0, unrealized: 0, realized: 0 }
  );
  const chartValues = (result?.chartSeries || []).map((point) => point.close);
  const chartPath = chartValues.length ? buildLinePath(chartValues, 560, 180) : "";

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
                          <button
                            type="button"
                            className="btn-ghost"
                            onClick={() => analyzeWatchlist(watchlist)}
                            disabled={loading || watchlist.items.length === 0}
                          >
                            Analyze all
                          </button>
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

                        <div className="mt-3 space-y-3">
                          {watchlist.items.length === 0 ? (
                            <span className="text-xs muted">No tickers yet.</span>
                          ) : (
                            watchlist.items.map((item) => (
                              <div key={item.id} className="rounded-2xl border bg-white/5 p-3">
                                <div className="flex items-start justify-between gap-3">
                                  <div>
                                    <button
                                      type="button"
                                      className="font-medium hover:underline"
                                      onClick={() => analyze({ ticker: item.symbol, watchlistId: watchlist.id })}
                                    >
                                      {item.symbol}
                                    </button>
                                    <div className="mt-1 flex flex-wrap gap-2 text-xs muted">
                                      <span>Last price {formatMoney(item.latestClose)}</span>
                                      <span>
                                        Last analysis{" "}
                                        {item.latestAnalysis?.createdAt
                                          ? new Date(item.latestAnalysis.createdAt).toLocaleDateString()
                                          : "never"}
                                      </span>
                                      <span>
                                        {item.latestAnalysis?.cached ? "Cached" : item.latestAnalysis ? "Fresh" : "Unanalyzed"}
                                      </span>
                                    </div>
                                  </div>
                                  <button
                                    type="button"
                                    className="text-xs muted hover:text-white"
                                    onClick={() => removeWatchlistItem(watchlist.id, item.symbol)}
                                  >
                                    Remove
                                  </button>
                                </div>

                                {item.latestAnalysis?.summary && (
                                  <p className="mt-3 line-clamp-2 text-xs muted">
                                    {item.latestAnalysis.summary}
                                  </p>
                                )}
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

              <div className="grid gap-6 2xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
                <div className="card card-pad">
                  <h2 className="h2">Price chart for {result.ticker}</h2>
                  <p className="mt-1 text-sm muted">Last 60 trading sessions with closing-price trend.</p>

                  {!result?.chartSeries?.length ? (
                    <div className="mt-6 rounded-2xl border border-dashed p-4 text-sm muted">
                      Run an analysis to load chart data.
                    </div>
                  ) : (
                    <div className="mt-6 space-y-4">
                      <div className="rounded-2xl border bg-black/10 p-4">
                        <svg viewBox="0 0 560 180" className="h-48 w-full" preserveAspectRatio="none">
                          <defs>
                            <linearGradient id="priceLineFill" x1="0" x2="0" y1="0" y2="1">
                              <stop offset="0%" stopColor="rgba(var(--accent),0.4)" />
                              <stop offset="100%" stopColor="rgba(var(--accent),0.02)" />
                            </linearGradient>
                          </defs>
                          <path d={`${chartPath} L 560 180 L 0 180 Z`} fill="url(#priceLineFill)" />
                          <path
                            d={chartPath}
                            fill="none"
                            stroke="rgb(var(--accent))"
                            strokeWidth="3"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-3">
                        <div className="rounded-2xl border bg-black/10 p-4">
                          <p className="text-xs muted">Start</p>
                          <p className="mt-1 text-sm text-white">{result.chartSeries[0]?.date || "--"}</p>
                        </div>
                        <div className="rounded-2xl border bg-black/10 p-4">
                          <p className="text-xs muted">End</p>
                          <p className="mt-1 text-sm text-white">{result.chartSeries[result.chartSeries.length - 1]?.date || "--"}</p>
                        </div>
                        <div className="rounded-2xl border bg-black/10 p-4">
                          <p className="text-xs muted">Latest close</p>
                          <p className="mt-1 text-sm text-white">{formatMoney(result.indicators?.latestClose)}</p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <div className="card card-pad">
                  <h2 className="h2">Market signals</h2>
                  <p className="mt-1 text-sm muted">Technical indicators that explain the generated analysis.</p>

                  {!result?.indicators ? (
                    <div className="mt-6 rounded-2xl border border-dashed p-4 text-sm muted">
                      Run an analysis to load technical indicators.
                    </div>
                  ) : (
                    <div className="mt-6 space-y-4">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="rounded-2xl border bg-black/10 p-4">
                          <p className="text-xs muted">Trend</p>
                          <p className="mt-1 text-sm text-white">{formatSentimentLabel(result.indicators.labels.trend)}</p>
                        </div>
                        <div className="rounded-2xl border bg-black/10 p-4">
                          <p className="text-xs muted">Momentum</p>
                          <p className="mt-1 text-sm text-white">{formatSentimentLabel(result.indicators.labels.momentum)}</p>
                        </div>
                        <div className="rounded-2xl border bg-black/10 p-4">
                          <p className="text-xs muted">Volatility</p>
                          <p className="mt-1 text-sm text-white">{formatSentimentLabel(result.indicators.labels.volatility)}</p>
                        </div>
                        <div className="rounded-2xl border bg-black/10 p-4">
                          <p className="text-xs muted">RSI (14)</p>
                          <p className="mt-1 text-sm text-white">
                            {result.indicators.rsi14 !== null ? result.indicators.rsi14.toFixed(2) : "--"}
                          </p>
                        </div>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="rounded-2xl border bg-black/10 p-4">
                          <p className="text-xs muted">SMA 20 / 50</p>
                          <p className="mt-1 text-sm text-white">
                            {formatMoney(result.indicators.sma20)} / {formatMoney(result.indicators.sma50)}
                          </p>
                        </div>
                        <div className="rounded-2xl border bg-black/10 p-4">
                          <p className="text-xs muted">MACD / Signal</p>
                          <p className="mt-1 text-sm text-white">
                            {result.indicators.macd !== null ? result.indicators.macd.toFixed(3) : "--"} /{" "}
                            {result.indicators.macdSignal !== null ? result.indicators.macdSignal.toFixed(3) : "--"}
                          </p>
                        </div>
                        <div className="rounded-2xl border bg-black/10 p-4">
                          <p className="text-xs muted">1D / 1W / 1M</p>
                          <p className="mt-1 text-sm text-white">
                            {formatSignedPercent(result.indicators.returns.day1)} / {formatSignedPercent(result.indicators.returns.week1)} / {formatSignedPercent(result.indicators.returns.month1)}
                          </p>
                        </div>
                        <div className="rounded-2xl border bg-black/10 p-4">
                          <p className="text-xs muted">Volume</p>
                          <p className="mt-1 text-sm text-white">
                            {formatCompactNumber(result.indicators.latestVolume)} vs {formatCompactNumber(result.indicators.averageVolume20)}
                          </p>
                        </div>
                      </div>

                      <div className="rounded-2xl border bg-black/10 p-4">
                        <p className="text-xs muted">52-week range</p>
                        <p className="mt-1 text-sm text-white">
                          {formatMoney(result.indicators.trailing52WeekLow)} - {formatMoney(result.indicators.trailing52WeekHigh)}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
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
                    <p className="mt-1 text-sm text-white">{recentAnalysesTotal}</p>
                    <p className="mt-2 text-xs muted">
                      Latest {recentAnalyses[0] ? new Date(recentAnalyses[0].createdAt).toLocaleString() : "none yet"}
                    </p>
                    <button
                      type="button"
                      className="btn-ghost mt-4 w-full"
                      onClick={() => {
                        setAnalysisPagination((current) => ({ ...current, page: 1 }));
                        setActivePanel("analyses");
                      }}
                    >
                      Open analyses
                    </button>
                  </div>

                  <div className="rounded-2xl border bg-black/10 p-4">
                    <p className="text-xs muted">Recent transactions</p>
                    <p className="mt-1 text-sm text-white">{recentTransactionsTotal}</p>
                    <p className="mt-2 text-xs muted">Realized {formatMoney(portfolioTotals.realized)}</p>
                    <button
                      type="button"
                      className="btn-ghost mt-4 w-full"
                      onClick={() => {
                        setTransactionPagination((current) => ({ ...current, page: 1 }));
                        setActivePanel("transactions");
                      }}
                    >
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
                <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_160px_auto]">
                  <input
                    className="input"
                    placeholder="Search ticker or summary"
                    value={analysisSearchDraft}
                    onChange={(e) => setAnalysisSearchDraft(e.target.value)}
                  />
                  <select
                    className="input"
                    value={analysisContextFilter}
                    onChange={(e) => {
                      setAnalysisContextFilter(e.target.value);
                      setAnalysisPagination((current) => ({ ...current, page: 1 }));
                    }}
                  >
                    <option value="all">All contexts</option>
                    <option value="direct">Direct</option>
                    <option value="watchlist">Watchlist</option>
                    <option value="portfolio">Portfolio</option>
                  </select>
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={() => {
                      setAnalysisSearch(analysisSearchDraft.trim());
                      setAnalysisPagination((current) => ({ ...current, page: 1 }));
                    }}
                  >
                    Search
                  </button>
                </div>

                {analysesLoading ? (
                  <div className="rounded-2xl border border-dashed p-4 text-sm muted">Loading analyses...</div>
                ) : analysisPanelItems.length === 0 ? (
                  <div className="rounded-2xl border border-dashed p-4 text-sm muted">No saved analyses yet.</div>
                ) : (
                  analysisPanelItems.map((analysis) => (
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

                <div className="flex items-center justify-between gap-3 pt-2">
                  <p className="text-xs muted">
                    Page {analysisPagination.page} of {analysisPagination.totalPages}
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="btn-ghost"
                      disabled={analysisPagination.page <= 1 || analysesLoading}
                      onClick={() =>
                        setAnalysisPagination((current) => ({ ...current, page: Math.max(1, current.page - 1) }))
                      }
                    >
                      Previous
                    </button>
                    <button
                      type="button"
                      className="btn-ghost"
                      disabled={analysisPagination.page >= analysisPagination.totalPages || analysesLoading}
                      onClick={() =>
                        setAnalysisPagination((current) => ({
                          ...current,
                          page: Math.min(current.totalPages, current.page + 1),
                        }))
                      }
                    >
                      Next
                    </button>
                  </div>
                </div>
              </div>
            )}

            {activePanel === "transactions" && (
              <div className="mt-6 space-y-3">
                <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_160px_180px_auto]">
                  <input
                    className="input"
                    placeholder="Search symbol, notes, or portfolio"
                    value={transactionSearchDraft}
                    onChange={(e) => setTransactionSearchDraft(e.target.value)}
                  />
                  <select
                    className="input"
                    value={transactionTypeFilter}
                    onChange={(e) => {
                      setTransactionTypeFilter(e.target.value);
                      setTransactionPagination((current) => ({ ...current, page: 1 }));
                    }}
                  >
                    <option value="all">All types</option>
                    <option value="BUY">Buy</option>
                    <option value="SELL">Sell</option>
                  </select>
                  <select
                    className="input"
                    value={transactionPortfolioFilter}
                    onChange={(e) => {
                      setTransactionPortfolioFilter(e.target.value);
                      setTransactionPagination((current) => ({ ...current, page: 1 }));
                    }}
                  >
                    <option value="all">All portfolios</option>
                    {portfolios.map((portfolio) => (
                      <option key={portfolio.id} value={portfolio.id}>
                        {portfolio.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={() => {
                      setTransactionSearch(transactionSearchDraft.trim());
                      setTransactionPagination((current) => ({ ...current, page: 1 }));
                    }}
                  >
                    Search
                  </button>
                </div>

                {transactionsLoading ? (
                  <div className="rounded-2xl border border-dashed p-4 text-sm muted">Loading transactions...</div>
                ) : transactionPanelItems.length === 0 ? (
                  <div className="rounded-2xl border border-dashed p-4 text-sm muted">No transactions yet.</div>
                ) : (
                  transactionPanelItems.map((transaction) => (
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

                <div className="flex items-center justify-between gap-3 pt-2">
                  <p className="text-xs muted">
                    Page {transactionPagination.page} of {transactionPagination.totalPages}
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="btn-ghost"
                      disabled={transactionPagination.page <= 1 || transactionsLoading}
                      onClick={() =>
                        setTransactionPagination((current) => ({ ...current, page: Math.max(1, current.page - 1) }))
                      }
                    >
                      Previous
                    </button>
                    <button
                      type="button"
                      className="btn-ghost"
                      disabled={transactionPagination.page >= transactionPagination.totalPages || transactionsLoading}
                      onClick={() =>
                        setTransactionPagination((current) => ({
                          ...current,
                          page: Math.min(current.totalPages, current.page + 1),
                        }))
                      }
                    >
                      Next
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
