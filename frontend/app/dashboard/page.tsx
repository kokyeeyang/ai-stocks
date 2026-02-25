"use client";

import { useEffect, useState } from "react";

const API = process.env.NEXT_PUBLIC_API_BASE!;

export default function Dashboard() {
  const [me, setMe] = useState<any>(null);
  const [ticker, setTicker] = useState("AAPL");
  const [result, setResult] = useState<any>(null);
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch(`${API}/me`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setMe(d.user))
      .catch(() => (window.location.href = "/login"));
  }, []);

  async function analyze() {
    setMsg("");
    setResult(null);
    setLoading(true);
    console.log('qeqweqwqeeq')

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
      setMsg(data.cached ? "Loaded cached analysis (≤12h old)." : "Fresh analysis generated.");
    } catch {
      setMsg("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function logout() {
    await fetch(`${API}/auth/logout`, { method: "POST", credentials: "include" });
    window.location.href = "/login";
  }

  return (
    <div className="page">
      {/* Top bar */}
      <header className="border-b bg-black/10">
        <div className="container-app flex items-center justify-between py-4">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-gradient-to-r from-[rgb(var(--accent))] to-[rgb(var(--accent2))]" />
            <div className="leading-tight">
              <div className="font-semibold">AI Stocks</div>
              <div className="text-xs muted">Dashboard</div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="badge muted hidden sm:inline">
              {me?.email ? `Signed in: ${me.email}` : "Loading..."}
            </span>
            <button onClick={logout} className="btn-ghost">
              Logout
            </button>
          </div>
        </div>
      </header>

      <main className="container-app py-8">
        <div className="mb-6">
          <h1 className="h1">Dashboard</h1>
          <p className="mt-1 muted">Analyze a ticker and review your latest output.</p>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          {/* Left column: analyze */}
          <div className="card card-pad lg:col-span-1">
            <h2 className="h2">Analyze</h2>
            <p className="mt-1 muted text-sm">Quick commentary based on recent price/volume.</p>

            <div className="mt-4 space-y-3">
              <label className="text-sm muted">Ticker</label>
              <input
                className="input"
                value={ticker}
                onChange={(e) => setTicker(e.target.value.toUpperCase())}
                placeholder="AAPL"
              />

              <button onClick={analyze} className="btn-primary w-full" disabled={loading}>
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

              <div className="mt-2 flex flex-wrap gap-2">
                {["AAPL", "MSFT", "NVDA", "TSLA", "AMZN"].map((t) => (
                  <button
                    key={t}
                    type="button"
                    className="badge hover:bg-white/5"
                    onClick={() => setTicker(t)}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Right column: results */}
          <div className="card card-pad lg:col-span-2">
            <h2 className="h2">Latest result</h2>
            <p className="mt-1 muted text-sm">
              {result?.cached ? "Cached result returned." : "Fresh result will appear here after analysis."}
            </p>

            {!result?.summary ? (
              <div className="mt-6 rounded-2xl border border-dashed p-6 muted">
                No analysis yet. Enter a ticker and click <span className="text-white">Analyze</span>.
              </div>
            ) : (
              <div className="mt-6 space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="badge">Ticker: {result.ticker}</span>
                  <span className="badge muted">{result.cached ? "Cached" : "Fresh"}</span>
                </div>

                <div className="rounded-2xl border bg-black/10 p-5">
                  <pre className="whitespace-pre-wrap text-sm leading-6">
                    {result.summary}
                  </pre>
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
      </main>
    </div>
  );
}