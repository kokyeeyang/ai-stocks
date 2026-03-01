"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

const API = process.env.NEXT_PUBLIC_API_BASE;

export default function Signup() {
  const router = useRouter();
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);

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

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg("");

    if (!API) {
      setMsg("App configuration error. Please try again later.");
      return;
    }

    setLoading(true);
    try {
      const resp = await fetch(`${API}/auth/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password }),
      });

      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        setMsg(data?.error || "Signup failed");
        return;
      }

      router.push("/dashboard");
    } catch {
      setMsg("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  if (checkingAuth) {
    return null;
  }

  return (
    <div className="page">
      <div className="container-app flex min-h-screen items-center justify-center py-10">
        <div className="w-full max-w-md">
          <div className="mb-6 text-center">
            <div className="mx-auto mb-3 h-12 w-12 rounded-2xl bg-gradient-to-r from-[rgb(var(--accent))] to-[rgb(var(--accent2))]" />
            <h1 className="h1">Create your account</h1>
            <p className="mt-1 muted">Sign up to save watchlists, manage portfolios, and run analyses.</p>
          </div>

          <div className="card card-pad">
            <form onSubmit={onSubmit} className="space-y-4">
              <div>
                <label className="mb-2 block text-sm muted" htmlFor="email">
                  Email
                </label>
                <input
                  id="email"
                  className="input"
                  placeholder="you@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  type="email"
                  required
                />
              </div>

              <div>
                <label className="mb-2 block text-sm muted" htmlFor="password">
                  Password
                </label>
                <input
                  id="password"
                  className="input"
                  placeholder="Minimum 8 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  type="password"
                  minLength={8}
                  required
                />
              </div>

              {msg && (
                <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm">
                  {msg}
                </div>
              )}

              <button className="btn-primary w-full" type="submit" disabled={loading}>
                {loading ? "Creating account..." : "Create account"}
              </button>

              <p className="text-sm muted">
                Already have an account?{" "}
                <Link className="text-white hover:underline" href="/login">
                  Log in
                </Link>
              </p>
            </form>
          </div>

          <p className="mt-6 text-center text-xs muted">
            Educational-only content. Not financial advice.
          </p>
        </div>
      </div>
    </div>
  );
}
