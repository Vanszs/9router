"use client";

import { useState, useEffect, useRef } from "react";
import { Modal, Button } from "@/shared/components";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import { getNextKiroSocialPollInterval } from "@/lib/oauth/kiroSocialPoll";

/**
 * Kiro Social OAuth Modal (Google/GitHub Device Code Flow)
 */
export default function KiroSocialOAuthModal({
  isOpen,
  provider,
  targetProvider,
  providerLabel = "Kiro",
  onSuccess,
  onClose,
}) {
  const [step, setStep] = useState("loading"); // "loading" | "polling" | "success" | "error"
  const [error, setError] = useState(null);
  const [userCode, setUserCode] = useState("");
  const [authUrl, setAuthUrl] = useState("");
  const { copied, copy } = useCopyToClipboard();
  const pollRef = useRef(null);
  const onSuccessRef = useRef(onSuccess);

  useEffect(() => {
    onSuccessRef.current = onSuccess;
  }, [onSuccess]);

  useEffect(() => {
    if (!isOpen || !provider) return;
    let cancelled = false;

    const stopPolling = () => {
      if (pollRef.current) clearTimeout(pollRef.current);
      pollRef.current = null;
    };

    const fail = (message) => {
      stopPolling();
      if (cancelled) return;
      setError(message);
      setStep("error");
    };

    const initAuth = async () => {
      try {
        setError(null);
        setStep("loading");

        const res = await fetch(`/api/oauth/kiro/social-authorize?provider=${provider}`);
        const data = await res.json();
        if (cancelled) return;

        if (!res.ok) {
          throw new Error(data.error || "Failed to start authorization");
        }

        setUserCode(data.userCode || "");
        setAuthUrl(data.authUrl || "");
        setStep("polling");

        const baseIntervalMs = Math.max(1, Number(data.interval) || 5) * 1000;
        let currentIntervalMs = baseIntervalMs;
        const expiresAt = Date.now() + Math.max(1, Number(data.expiresIn) || 300) * 1000;

        const schedule = (delayMs) => {
          if (cancelled) return;
          pollRef.current = setTimeout(poll, delayMs);
        };

        let consecutiveErrors = 0;
        const poll = async () => {
          pollRef.current = null;
          if (cancelled) return;
          if (Date.now() >= expiresAt) {
            fail("Authorization code expired. Please try again.");
            return;
          }

          try {
            const pollRes = await fetch("/api/oauth/kiro/social-exchange", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ deviceCode: data.deviceCode, provider, targetProvider }),
            });
            const pollData = await pollRes.json();
            if (cancelled) return;

            if (pollData.success) {
              stopPolling();
              setStep("success");
              onSuccessRef.current?.();
              return;
            }

            if (!pollData.pending) {
              fail(pollData.error || "Authorization failed");
              return;
            }

            consecutiveErrors = 0;
            currentIntervalMs = getNextKiroSocialPollInterval(currentIntervalMs, pollData.error);
            schedule(currentIntervalMs);
          } catch {
            consecutiveErrors += 1;
            if (consecutiveErrors >= 5) {
              fail("Network error: Unable to reach authorization server. Please try again.");
              return;
            }
            schedule(currentIntervalMs);
          }
        };

        schedule(baseIntervalMs);
      } catch (err) {
        fail(err.message);
      }
    };

    initAuth();

    return () => {
      cancelled = true;
      stopPolling();
    };
  }, [isOpen, provider, targetProvider]);

  const handleClose = () => {
    if (pollRef.current) {
      clearTimeout(pollRef.current);
      pollRef.current = null;
    }
    onClose?.();
  };

  const providerName = provider === "google" ? "Google" : "GitHub";

  return (
    <Modal
      isOpen={isOpen}
      title={`Connect ${providerLabel} via ${providerName}`}
      onClose={handleClose}
      size="lg"
    >
      <div className="flex flex-col gap-4">
        {step === "loading" && (
          <div className="text-center py-6">
            <div className="size-16 mx-auto mb-4 rounded-full bg-primary/10 flex items-center justify-center">
              <span className="material-symbols-outlined text-3xl text-primary animate-spin">
                progress_activity
              </span>
            </div>
            <h3 className="text-lg font-semibold mb-2">Initializing...</h3>
            <p className="text-sm text-text-muted">Setting up {providerName} authentication</p>
          </div>
        )}

        {step === "polling" && (
          <div className="text-center py-6">
            <div className="size-16 mx-auto mb-4 rounded-full bg-primary/10 flex items-center justify-center">
              <span className="material-symbols-outlined text-3xl text-primary animate-pulse">
                open_in_browser
              </span>
            </div>
            <h3 className="text-lg font-semibold mb-2">Authorize in Browser</h3>
            <p className="text-sm text-text-muted mb-3">
              Open the link below and enter your verification code:
            </p>
            {authUrl && (
              <div className="mb-4">
                <div className="flex items-center gap-2 justify-center">
                  <a
                    href={authUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs font-mono text-primary underline break-all max-w-md inline-block"
                  >
                    {authUrl.length > 80 ? authUrl.slice(0, 80) + "..." : authUrl}
                  </a>
                  <button
                    onClick={() => copy(authUrl, "auth_url")}
                    className="shrink-0 p-1 rounded hover:bg-sidebar text-text-muted hover:text-text"
                    title="Copy Link"
                  >
                    <span className="material-symbols-outlined text-base">
                      {copied === "auth_url" ? "check" : "content_copy"}
                    </span>
                  </button>
                </div>
              </div>
            )}
            {userCode && (
              <div className="mb-4">
                <p className="text-xs text-text-muted mb-1">Verification Code</p>
                <div className="flex items-center justify-center gap-2">
                  <p className="font-mono text-2xl font-bold tracking-widest">{userCode}</p>
                  <button
                    onClick={() => copy(userCode, "user_code")}
                    className="shrink-0 p-1 rounded hover:bg-sidebar text-text-muted hover:text-text"
                    title="Copy Code"
                  >
                    <span className="material-symbols-outlined text-base">
                      {copied === "user_code" ? "check" : "content_copy"}
                    </span>
                  </button>
                </div>
              </div>
            )}
            <div className="flex items-center justify-center gap-2 text-sm text-text-muted">
              <span className="material-symbols-outlined text-base animate-spin">
                progress_activity
              </span>
              Waiting for authorization in browser...
            </div>
            <div className="mt-6">
              <Button onClick={handleClose} variant="ghost" fullWidth>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {step === "success" && (
          <div className="text-center py-6">
            <div className="size-16 mx-auto mb-4 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
              <span className="material-symbols-outlined text-3xl text-green-600">
                check_circle
              </span>
            </div>
            <h3 className="text-lg font-semibold mb-2">Connected Successfully!</h3>
            <p className="text-sm text-text-muted mb-4">
              Your {providerLabel} account via {providerName} has been connected.
            </p>
            <Button onClick={handleClose} fullWidth>
              Done
            </Button>
          </div>
        )}

        {step === "error" && (
          <div className="text-center py-6">
            <div className="size-16 mx-auto mb-4 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
              <span className="material-symbols-outlined text-3xl text-red-600">error</span>
            </div>
            <h3 className="text-lg font-semibold mb-2">Connection Failed</h3>
            <p className="text-sm text-red-600 mb-4">{error}</p>
            <div className="flex gap-2">
              <Button onClick={handleClose} variant="ghost" fullWidth>
                Close
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
