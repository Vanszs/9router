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
  const isLocal = initialAuth?.isLocal === true;
  const passkeysEnabled = initialAuth?.passkeysEnabled === true;
  const remoteAuthMode = initialAuth?.remoteAuthMode || "password";
  const [passkeyLoading, setPasskeyLoading] = useState(false);
  const [passkeyError, setPasskeyError] = useState("");
  const router = useRouter();

  useEffect(() => {
    if (retryAfter <= 0) return;
    const id = setInterval(() => dispatch({ type: "TICK" }), 1000);
    return () => clearInterval(id);
  }, [retryAfter]);

  if (initialAuth?.requireLogin === false) {
    router.push("/dashboard");
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
      });

      if (res.ok) {
        router.push("/dashboard");
        router.refresh();
      } else {
        const data = await res.json();
        dispatch({ type: "ERROR", error: data.error || "Password salah", resetHint: data.resetHint, retryAfter: data.retryAfter ? Number(data.retryAfter) : 0 });
      }
    } catch (err) {
      dispatch({ type: "ERROR", error: "Terjadi kesalahan. Silakan coba lagi." });
    }
  };

  const handlePasskeyLogin = async () => {
    setPasskeyLoading(true);
    setPasskeyError("");
    try {
      const startRes = await fetch("/api/auth/passkey/login/start", { method: "POST" });
      if (!startRes.ok) {
        const data = await startRes.json();
        setPasskeyError(data.error || "Login passkey gagal");
        return;
      }
      const options = await startRes.json();

      const { startAuthentication } = await import("@/lib/auth/passkeyBrowser.js");
      const assertion = await startAuthentication({ optionsJSON: options });

      const finishRes = await fetch("/api/auth/passkey/login/finish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assertion }),
      });

      if (finishRes.ok) {
        router.push("/dashboard");
        router.refresh();
      } else {
        const data = await finishRes.json();
        setPasskeyError(data.error || "Verifikasi passkey gagal");
      }
    } catch (err) {
      if (err.name === "NotAllowedError") {
        setPasskeyError("Autentikasi passkey dibatalkan atau kedaluwarsa.");
      } else {
        setPasskeyError(err.message || "Terjadi kesalahan saat login passkey.");
      }
    } finally {
      setPasskeyLoading(false);
    }
  };

  const oidcAvailable = oidcConfigured && ["oidc", "both"].includes(authMode);
  const passkeyAvailable = passkeysEnabled && (isLocal || ["passkey", "both"].includes(remoteAuthMode));
  const passwordAvailable = isLocal
    ? (authMode !== "oidc" || !oidcConfigured)
    : (remoteAuthMode !== "passkey" && (authMode !== "oidc" || !oidcConfigured));

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
              ? "Masuk dengan OIDC provider untuk mengakses dashboard"
              : passkeyAvailable && !passwordAvailable
                ? "Masuk dengan passkey untuk mengakses dashboard"
                : "Masukkan password untuk mengakses dashboard"}
          </p>
        </div>

        <Card>
          <div className="flex flex-col gap-4">
            {oidcAvailable && (
              <Button type="button" variant="primary" className="w-full" onClick={handleOidcLogin}>
                {oidcLoginLabel}
              </Button>
            )}

            {oidcAvailable && (passwordAvailable || passkeyAvailable) && <div className="h-px bg-border/60" />}

            {passkeyAvailable && (
              <Button
                type="button"
                variant="primary"
                className="w-full"
                onClick={handlePasskeyLogin}
                loading={passkeyLoading}
              >
                <span className="flex items-center justify-center gap-2">
                  <span className="material-symbols-outlined text-[20px]">key</span>
                  Masuk dengan Passkey
                </span>
              </Button>
            )}

            {passkeyAvailable && passwordAvailable && <div className="h-px bg-border/60" />}

            {passkeyError && <p className="text-xs text-red-500 text-center">{passkeyError}</p>}

            {passwordAvailable ? (
              <form onSubmit={handleLogin} className="flex flex-col gap-4">
                {((authMode === "oidc" && !oidcConfigured) || (authMode === "both" && !oidcConfigured)) && (
                  <p className="text-xs text-amber-600 dark:text-amber-400 text-center">
                    OIDC login aktif, tapi issuer/client belum dikonfigurasi. Password login masih tersedia.
                  </p>
                )}

                {authMode === "both" && oidcConfigured && (
                  <p className="text-xs text-text-muted text-center">
                    Password dan OIDC login keduanya aktif.
                  </p>
                )}

                <div className="flex flex-col gap-2">
                  <label htmlFor="masuk-password" className="text-sm font-semibold text-text-main">Password</label>
                  <Input
                    id="masuk-password"
                    type="password"
                    placeholder="Masukkan password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoFocus={!oidcAvailable && !passkeyAvailable}
                  />
                  {error && <p className="text-xs text-red-500">{error}</p>}
                  {retryAfter > 0 && (
                    <p className="text-xs text-amber-600 dark:text-amber-400">
                      Terkunci. Coba lagi dalam <span className="font-mono">{retryAfter}s</span>.
                    </p>
                  )}
                  {resetHint && (
                    <p className="text-xs text-text-muted">
                      Lupa password? Buka <code className="bg-sidebar px-1 rounded">vansrouter</code> CLI di host → <b>Settings</b> → <b>Reset Password to Default</b>.
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
                  {retryAfter > 0 ? `Tunggu ${retryAfter}s` : "Masuk"}
                </Button>

                <p className="text-xs text-center text-text-muted mt-2">
                  Password default adalah <code className="bg-sidebar px-1 rounded">123456</code>
                </p>
                {hasPassword === false && (
                  <p className="text-xs text-center text-text-muted">
                    Custom password belum diset. Password default di atas akan berfungsi sampai diganti.
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
