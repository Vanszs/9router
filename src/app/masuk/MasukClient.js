"use client";

import { useState, useEffect, useReducer } from "react";
import { Card, Button, Input } from "@/shared/components";
import { useRouter } from "next/navigation";

function handleOidcLogin() {
  window.location.href = "/api/auth/oidc/start";
}

function loginReducer(state, action) {
  switch (action.type) {
    case "SUBMIT": return { ...state, loading: true, error: "", resetHint: "" };
    case "ERROR": return { ...state, loading: false, error: action.error, resetHint: action.resetHint || "", retryAfter: action.retryAfter || 0 };
    case "DONE": return { ...state, loading: false };
    case "TICK": return { ...state, retryAfter: state.retryAfter > 0 ? state.retryAfter - 1 : 0 };
    default: return state;
  }
}

export default function MasukClient({ initialAuth }) {
  const [password, setPassword] = useState("");
  const [state, dispatch] = useReducer(loginReducer, { error: "", resetHint: "", retryAfter: 0, loading: false });
  const { error, resetHint, retryAfter, loading } = state;
  const hasPassword = initialAuth?.hasPassword ?? null;
  const authMode = initialAuth?.authMode || "password";
  const oidcConfigured = initialAuth?.oidcConfigured || false;
  const oidcLoginLabel = initialAuth?.oidcLoginLabel || "Masuk dengan OIDC";
  const router = useRouter();

  useEffect(() => {
    if (retryAfter <= 0) return;
    const id = setInterval(() => dispatch({ type: "TICK" }), 1000);
    return () => clearInterval(id);
  }, [retryAfter]);

  // Full navigation (not router.push) so auth cookie is applied and RSC
  // reloads cleanly. Soft client nav after set-cookie often stuck on /masuk
  // in Turbopack dev when HMR was blocked cross-origin.
  useEffect(() => {
    if (initialAuth?.requireLogin === false) {
      window.location.assign("/dashboard");
    }
  }, [initialAuth?.requireLogin]);

  if (initialAuth?.requireLogin === false) {
    return null;
  }

  const handleLogin = async (e) => {
    e.preventDefault();
    dispatch({ type: "SUBMIT" });

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
        credentials: "same-origin",
      });

      if (res.ok) {
        window.location.assign("/dashboard");
        return;
      } else {
        const data = await res.json();
        dispatch({ type: "ERROR", error: data.error || "Invalid password", resetHint: data.resetHint, retryAfter: data.retryAfter ? Number(data.retryAfter) : 0 });
      }
    } catch (err) {
      dispatch({ type: "ERROR", error: "Something went wrong. Please try again." });
    }
  };

  const oidcAvailable = oidcConfigured && ["oidc", "both"].includes(authMode);
  const passwordAvailable = authMode !== "oidc" || !oidcConfigured;

  if (hasPassword === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg p-4">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          <p className="text-text-muted mt-4">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <main role="main" className="min-h-screen flex items-center justify-center bg-bg p-4 relative overflow-hidden">
      <div className="landing-grid absolute inset-0 pointer-events-none" aria-hidden="true" />
      <div className="relative z-10 w-full max-w-md">
        <div className="text-center mb-8">
          <div className="flex justify-center mb-4">
            <svg viewBox="0 0 32 32" className="w-12 h-12" fill="none">
              <path d="M16 5L22 14L16 27L10 14L16 5Z" fill="#6366f1" opacity="0.9"/>
              <path d="M10 14L16 27L10 20L6 14H10Z" fill="#6366f1" opacity="0.6"/>
              <path d="M22 14L16 27L22 20L26 14H22Z" fill="#6366f1" opacity="0.6"/>
              <circle cx="16" cy="9" r="2" fill="#6366f1"/>
            </svg>
          </div>
          <h1 className="text-3xl font-bold text-primary mb-2">VansAI</h1>
          <p className="text-text-muted text-sm">
            {authMode === "oidc" && oidcConfigured
              ? "Sign in with OIDC to access the dashboard"
              : "Enter password to access the dashboard"}
          </p>
        </div>

        <Card>
          <div className="flex flex-col gap-4">
            {oidcAvailable && (
              <Button type="button" variant="primary" className="w-full" onClick={handleOidcLogin}>
                {oidcLoginLabel}
              </Button>
            )}

            {oidcAvailable && passwordAvailable && <div className="h-px bg-border/60" />}

            {passwordAvailable ? (
              <form onSubmit={handleLogin} className="flex flex-col gap-4">
                {((authMode === "oidc" && !oidcConfigured) || (authMode === "both" && !oidcConfigured)) && (
                  <p className="text-xs text-amber-600 dark:text-amber-400 text-center">
                    OIDC is enabled but issuer/client is not configured. Password login is still available.
                  </p>
                )}

                {authMode === "both" && oidcConfigured && (
                  <p className="text-xs text-text-muted text-center">
                    Password and OIDC login are both available.
                  </p>
                )}

                <div className="flex flex-col gap-2">
                  <label htmlFor="masuk-password" className="text-sm font-semibold text-text-main">Password</label>
                  <Input
                    id="masuk-password"
                    type="password"
                    placeholder="Enter password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoFocus={!oidcAvailable}
                  />
                  {error && <p className="text-xs text-red-500">{error}</p>}
                  {retryAfter > 0 && (
                    <p className="text-xs text-amber-600 dark:text-amber-400">
                      Locked. Try again in <span className="font-mono">{retryAfter}s</span>.
                    </p>
                  )}
                  {resetHint && (
                    <p className="text-xs text-text-muted">
                      Forgot password? Open the <code className="bg-sidebar px-1 rounded">vansrouter</code> CLI on the host → <b>Settings</b> → <b>Reset Password to Default</b>.
                    </p>
                  )}
                </div>

                <Button
                  type="submit"
                  variant="primary"
                  className="w-full"
                  loading={loading}
                  disabled={retryAfter > 0}
                >
                  {retryAfter > 0 ? `Wait ${retryAfter}s` : "Sign in"}
                </Button>

                <p className="text-xs text-center text-text-muted mt-2">
                  Default password is <code className="bg-sidebar px-1 rounded">123456</code>
                </p>
                {hasPassword === false && (
                  <p className="text-xs text-center text-text-muted">
                    No custom password set. The default above works until you change it.
                  </p>
                )}
              </form>
            ) : (
              error && <p className="text-xs text-red-500">{error}</p>
            )}
          </div>
        </Card>
      </div>
    </main>
  );
}