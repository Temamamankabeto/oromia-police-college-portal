"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "same-origin",
        body: JSON.stringify({ email, password }),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        setError(result.error || "Login failed");
        return;
      }

      router.replace("/dashboard");
      router.refresh();
    } catch {
      setError("Unable to connect to the server.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-10">
      <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-xl">
        <div className="bg-blue-950 px-8 py-10 text-center text-white">
          <h1 className="text-2xl font-bold">
            Oromia Police College
          </h1>
          <p className="mt-2 text-sm text-blue-100">
            Requirements Gathering and Approval Portal
          </p>
        </div>

        <div className="px-8 py-9">
          <h2 className="text-2xl font-bold text-slate-900">
            Staff Login
          </h2>
          <p className="mt-2 text-sm text-slate-500">
            Sign in using your authorized staff account.
          </p>

          <form onSubmit={handleSubmit} className="mt-7 space-y-5">
            <div>
              <label
                htmlFor="email"
                className="mb-2 block text-sm font-medium text-slate-700"
              >
                Email Address
              </label>
              <input
                id="email"
                type="email"
                required
                autoComplete="username"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="w-full rounded-lg border border-slate-300 px-4 py-3 text-slate-900 outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-100"
                placeholder="staff@example.com"
              />
            </div>

            <div>
              <label
                htmlFor="password"
                className="mb-2 block text-sm font-medium text-slate-700"
              >
                Password
              </label>
              <input
                id="password"
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="w-full rounded-lg border border-slate-300 px-4 py-3 text-slate-900 outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-100"
                placeholder="Enter your password"
              />
            </div>

            {error && (
              <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-blue-900 px-5 py-3 font-semibold text-white transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? "Signing in..." : "Sign In"}
            </button>
          </form>

          <div className="mt-7 border-t border-slate-200 pt-5 text-center">
            <Link
              href="/"
              className="text-sm font-medium text-blue-900 hover:underline"
            >
              Return to Homepage
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
