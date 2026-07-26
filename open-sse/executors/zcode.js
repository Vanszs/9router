import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { HTTP_STATUS, DEFAULT_RETRY_CONFIG, resolveRetryEntry, FETCH_CONNECT_TIMEOUT_MS, capRetryAttemptsByAccountCount } from "../config/runtimeConfig.js";
import { shouldRefreshCredentials } from "../services/oauthCredentialManager.js";
import os from "os";
import { randomUUID } from "node:crypto";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { injectReasoningContent } from "../utils/reasoningContentInjector.js";
import { dbg } from "../utils/debugLog.js";

const ZCODE_PLAN_BASE = "https://zcode.z.ai/api/v1/zcode-plan/anthropic";
const CAPTCHA_TTL_MS = 4 * 60 * 1000;

let _zcodeSourceHeaders = null;
function buildZCodeSourceHeaders() {
  if (_zcodeSourceHeaders) return _zcodeSourceHeaders;
  const arch = os.arch() || "x64";
  const platform = os.platform() || "linux";
  _zcodeSourceHeaders = {
    "User-Agent": "ZCode/3.1.0",
    "HTTP-Referer": "https://zcode.z.ai",
    "X-Title": "Z Code@electron",
    "X-ZCode-App-Version": "3.1.0",
    "X-ZCode-Agent": "glm",
    "X-Platform": `${platform}-${arch}`,
    "X-Client-Language": "en",
    "X-Client-Timezone": Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    "X-Os-Category": platform === "darwin" ? "macos" : platform === "win32" ? "windows" : "linux",
    "X-Os-Version": os.release?.() || "",
  };
  return _zcodeSourceHeaders;
}

let _cachedCaptcha = null;
let _captchaExpiry = 0;
let _captchaPromise = null;

async function solveCaptcha(log) {
  if (_cachedCaptcha && Date.now() < _captchaExpiry) return _cachedCaptcha;
  if (_captchaPromise) return _captchaPromise;

  _captchaPromise = (async () => {
    const { chromium } = await import("playwright-core");
    let browser;
    try {
      browser = await chromium.launch({
        headless: true,
        executablePath: process.env.VANS_ZCODE_CHROMIUM_PATH || undefined,
        args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-blink-features=AutomationControlled", "--disable-features=IsolateOrigins,site-per-process", "--window-size=1280,720"],
        ignoreDefaultArgs: ["--enable-automation"],
      });
      const ctx = await browser.newContext({
        userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.6533.72 Safari/537.36",
        viewport: { width: 1280, height: 720 },
        locale: "en-US",
        timezoneId: "Asia/Jakarta",
        extraHTTPHeaders: { "Accept-Language": "en-US,en;q=0.9" },
      });
      await ctx.addInitScript(() => {
        Object.defineProperty(navigator, "webdriver", { get: () => undefined });
        Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3, 4, 5] });
        Object.defineProperty(navigator, "languages", { get: () => ["en-US", "en"] });
        window.AliyunCaptchaConfig = { region: "sgp", prefix: "no8xfe" };
      });
      const page = await ctx.newPage();
      await page.goto("https://zcode.z.ai/", { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(2000);
      await page.mouse.move(100, 100);
      await page.mouse.move(300, 200);
      await page.mouse.move(500, 300);
      await page.waitForTimeout(500);

      const param = await page.evaluate(async () => {
        if (!window.initAliyunCaptcha) {
          await new Promise((res, rej) => {
            const s = document.createElement("script");
            s.src = "https://o.alicdn.com/captcha-frontend/aliyunCaptcha/AliyunCaptcha.js";
            s.onload = res;
            s.onerror = rej;
            document.head.appendChild(s);
          });
        }
        return new Promise((resolve) => {
          const t = setTimeout(() => resolve(null), 25000);
          window.initAliyunCaptcha({
            SceneId: "11xygtvd",
            mode: "popup",
            getInstance: (inst) => {
              if (typeof inst.startTracelessVerification === "function") inst.startTracelessVerification();
            },
            success: (p) => { clearTimeout(t); resolve(p); },
            fail: () => { clearTimeout(t); resolve(null); },
            onError: () => { clearTimeout(t); resolve(null); },
          });
        });
      });

      await browser.close();

      if (!param) {
        log?.warn?.("CAPTCHA", "solve returned null");
        _cachedCaptcha = null;
        _captchaExpiry = 0;
        return null;
      }

      _cachedCaptcha = param;
      _captchaExpiry = Date.now() + CAPTCHA_TTL_MS;
      log?.info?.("CAPTCHA", `solved, cached for ${CAPTCHA_TTL_MS / 1000}s`);
      return param;
    } catch (err) {
      if (browser) await browser.close().catch(() => {});
      log?.warn?.("CAPTCHA", `solve failed: ${err.message}`);
      _cachedCaptcha = null;
      _captchaExpiry = 0;
      return null;
    } finally {
      _captchaPromise = null;
    }
  })();

  return _captchaPromise;
}

export class ZcodeExecutor extends BaseExecutor {
  constructor() {
    super("zcode", PROVIDERS.zcode);
  }

  resolveBaseUrl() {
    return ZCODE_PLAN_BASE;
  }

  buildUrl(model, stream, urlIndex = 0, credentials = null) {
    return `${this.resolveBaseUrl()}/v1/messages`;
  }

  buildHeaders(credentials, stream = true, captchaParam = null) {
    const zcodeJwtToken = credentials?.providerSpecificData?.zcodeJwtToken || "";
    const headers = {
      "Content-Type": "application/json",
      ...this.config.headers,
      ...buildZCodeSourceHeaders(),
      "Authorization": `Bearer ${zcodeJwtToken}`,
      "anthropic-version": "2023-06-01",
      "x-request-id": randomUUID(),
    };
    if (captchaParam) {
      headers["X-Aliyun-Captcha-Verify-Param"] = captchaParam;
      headers["X-Aliyun-Captcha-Verify-Region"] = "sgp";
    }
    if (stream) headers["Accept"] = "text/event-stream";
    return headers;
  }

  transformRequest(model, body, stream, credentials) {
    const isReasoning = typeof model === "string" && model.endsWith("-Max");
    const upstreamModel = isReasoning ? model.slice(0, -4) : model;
    const nextBody = { ...body, model: upstreamModel };

    if (isReasoning) {
      const BUDGET = 4096;
      const currentMax = Number(nextBody.max_tokens) || 0;
      if (!currentMax || currentMax <= BUDGET) nextBody.max_tokens = BUDGET + 4096;
      nextBody.thinking = { ...(nextBody.thinking || {}), type: "enabled", budget_tokens: BUDGET };
    }

    return injectReasoningContent({ provider: this.provider, model, body: nextBody });
  }

  async execute({ model, body, stream, credentials, signal, log, proxyOptions = null, accountCount = 0 }) {
    const captchaParam = await solveCaptcha(log);
    const url = this.buildUrl(model, stream, 0, credentials);
    const transformedBody = this.transformRequest(model, body, stream, credentials);
    const headers = this.buildHeaders(credentials, stream, captchaParam);

    const retryConfig = capRetryAttemptsByAccountCount(
      { ...DEFAULT_RETRY_CONFIG, ...this.config.retry },
      accountCount
    );
    const retryAttempts = { count: 0 };
    const maxRetries = retryConfig[403]?.attempts ?? retryConfig[401]?.attempts ?? 1;

    while (retryAttempts.count <= maxRetries) {
      const connectCtrl = new AbortController();
      const timeoutMs = this.config?.timeoutMs || FETCH_CONNECT_TIMEOUT_MS;
      const connectTimer = setTimeout(() => connectCtrl.abort(new Error("fetch connect timeout")), timeoutMs);
      const mergedSignal = signal ? AbortSignal.any([signal, connectCtrl.signal]) : connectCtrl.signal;

      try {
        const bodyStr = JSON.stringify(transformedBody);
        dbg("FETCH", `ZCODE → ${url} | body=${bodyStr.length}B | captcha=${captchaParam ? "yes" : "no"}`);
        const response = await proxyAwareFetch(url, {
          method: "POST",
          headers,
          body: bodyStr,
          signal: mergedSignal,
        }, proxyOptions);
        clearTimeout(connectTimer);

        const ct = response.headers?.get?.("content-type") || "";
        dbg("FETCH", `ZCODE ← ${response.status} | ct=${ct}`);

        if ((response.status === 401 || response.status === 403) && retryAttempts.count < maxRetries) {
          retryAttempts.count++;
          const delayMs = retryConfig[response.status]?.delayMs ?? 2000;
          log?.warn?.("RETRY", `${response.status}, captcha retry ${retryAttempts.count}/${maxRetries} after ${delayMs}ms`);
          _cachedCaptcha = null;
          _captchaExpiry = 0;
          const freshCaptcha = await solveCaptcha(log);
          if (freshCaptcha) {
            headers["X-Aliyun-Captcha-Verify-Param"] = freshCaptcha;
            continue;
          }
        }

        return { response, url, headers, transformedBody };
      } catch (error) {
        clearTimeout(connectTimer);
        if (error.name === "AbortError" && !connectCtrl.signal.aborted) throw error;
        throw error;
      }
    }

    throw new Error(`ZCode Plan request failed after ${maxRetries} retries`);
  }

  async refreshCredentials(credentials, log, proxyOptions = null) {
    if (!credentials?.accessToken) return null;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    let response;
    try {
      response = await proxyAwareFetch("https://api.z.ai/api/auth/z/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-request-id": randomUUID(),
        },
        body: JSON.stringify({ token: credentials.accessToken }),
        signal: ctrl.signal,
      }, proxyOptions);
    } catch (err) {
      clearTimeout(timer);
      log?.warn?.("TOKEN", `Zcode business-token refresh failed: ${err.message}`);
      return null;
    }
    clearTimeout(timer);
    if (!response.ok) {
      log?.warn?.("TOKEN", `Zcode business-token refresh HTTP ${response.status}`);
      return null;
    }
    const data = await response.json().catch(() => null);
    const newBusinessToken = data?.data?.access_token || data?.data?.token || "";
    if (!newBusinessToken) {
      log?.warn?.("TOKEN", "Zcode business-token refresh: empty token in response");
      return null;
    }
    return {
      accessToken: credentials.accessToken,
      providerSpecificData: {
        ...(credentials.providerSpecificData || {}),
        businessToken: newBusinessToken,
      },
    };
  }
}
