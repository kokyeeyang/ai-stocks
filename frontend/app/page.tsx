"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

const API = process.env.NEXT_PUBLIC_API_BASE;

export default function Home() {
  const router = useRouter();
  const [checkingAuth, setCheckingAuth] = useState(true);

  useEffect(() => {
    if (!API) {
      setCheckingAuth(false);
      return;
    }

    fetch(`${API}/me`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(() => router.replace("/dashboard"))
      .catch(() => setCheckingAuth(false));
  }, [router]);

  if (checkingAuth) {
    return null;
  }

  return (
    <div className="page">
      <div className="container-app flex min-h-screen items-center justify-center py-10">
        <div className="w-full max-w-5xl">
          <div className="mb-6 text-center">
            <div className="mx-auto mb-3 h-12 w-12 rounded-2xl bg-gradient-to-r from-[rgb(var(--accent))] to-[rgb(var(--accent2))]" />
            <h1 className="h1">AI Stock Analyzer</h1>
            <p className="mt-1 muted">Login to analyze a ticker.</p>
          </div>

          <div className="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
            <div className="card card-pad">
              <h2 className="h2">Get started</h2>
              <p className="mt-1 text-sm muted">
                Create an account, sign in, or jump to the dashboard if you already have an active session.
              </p>

              <div className="mt-4 space-y-3">
                <Link className="btn-primary block w-full text-center" href="/signup">
                  Sign up
                </Link>
                <Link className="btn-ghost block w-full text-center" href="/login">
                  Log in
                </Link>
                <Link className="btn-ghost block w-full text-center" href="/dashboard">
                  Dashboard
                </Link>
              </div>
            </div>

            <div className="card card-pad">
              <h2 className="h2">What this does</h2>
              <p className="mt-1 text-sm muted">
                Analyze a stock ticker and review generated commentary based on recent price and volume data.
              </p>

              <div className="mt-6 space-y-4">
                <div className="rounded-2xl border bg-black/10 p-5">
                  <p className="text-sm leading-6 muted">
                    The dashboard lets you run quick analyses, inspect cached versus fresh results, and review the
                    underlying input payload used to generate each summary.
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  {["AAPL", "MSFT", "NVDA", "TSLA", "AMZN"].map((ticker) => (
                    <span key={ticker} className="badge">
                      {ticker}
                    </span>
                  ))}
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
