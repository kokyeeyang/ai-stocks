"use client";

import { useEffect, useState } from "react";
const API = process.env.NEXT_PUBLIC_API_BASE!;

export default function Dashboard() {
  const [me, setMe] = useState<any>(null);
  const [ticker, setTicker] = useState("AAPL");
  const [result, setResult] = useState<any>(null);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    fetch(`${API}/me`, { credentials: "include" })
      .then((r) => r.ok ? r.json() : Promise.reject())
      .then((d) => setMe(d.user))
      .catch(() => (window.location.href = "/login"));
  }, []);

  async function analyze() {
    setMsg("Analyzing...");
    setResult(null);

    const resp = await fetch(`${API}/stocks/analyze?ticker=${encodeURIComponent(ticker)}`, {
      credentials: "include"
    });

    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) return setMsg(data?.error || "Failed");

    setResult(data);
    setMsg(data.cached ? "Loaded cached analysis (<=12h old)." : "Fresh analysis generated.");
  }

  async function logout() {
    await fetch(`${API}/auth/logout`, { method: "POST", credentials: "include" });
    window.location.href = "/login";
  }

  return (
    <main style={{ maxWidth: 820, margin: "40px auto", fontFamily: "system-ui" }}>
      <h1>Dashboard</h1>
      <p>Logged in as: {me?.email}</p>
      <button onClick={logout}>Logout</button>

      <hr style={{ margin: "24px 0" }} />

      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <input value={ticker} onChange={(e) => setTicker(e.target.value.toUpperCase())} style={{ width: 140 }} />
        <button onClick={analyze}>Analyze</button>
      </div>

      <p>{msg}</p>

      {result?.summary && (
        <div style={{ whiteSpace: "pre-wrap", border: "1px solid #ddd", padding: 16, borderRadius: 8 }}>
          {result.summary}
        </div>
      )}
    </main>
  );
}
