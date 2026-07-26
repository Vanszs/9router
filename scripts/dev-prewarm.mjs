import { setTimeout as sleep } from "node:timers/promises";

const PORT = process.env.PORT || 20127;
const HOST = process.env.HOST || "127.0.0.1";
const PASSWORD = process.env.VANS_PREWARM_PASSWORD;
if (!PASSWORD) {
  console.error("VANS_PREWARM_PASSWORD is required (set it to the dashboard password)");
  process.exit(1);
}
const base = `http://${HOST}:${PORT}`;

const publicPaths = ["/", "/login", "/api/auth/status"];
const authPaths = [
  "/dashboard",
  "/dashboard/providers",
  "/dashboard/basic-chat",
  "/dashboard/console-log",
  "/dashboard/endpoint",
  "/api/providers",
  "/api/settings",
  "/api/models/availability",
];

async function waitReady(maxMs = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    try {
      const r = await fetch(`${base}/api/auth/status`, { redirect: "manual" });
      if (r.status < 500) return true;
    } catch {
      /* not up yet */
    }
    await sleep(500);
  }
  return false;
}

async function login() {
  const res = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: PASSWORD }),
    redirect: "manual",
  });
  const setCookie = res.headers.getSetCookie?.() || [];
  const raw = setCookie.length
    ? setCookie.map((c) => c.split(";")[0]).join("; ")
    : (res.headers.get("set-cookie") || "").split(",").map((c) => c.split(";")[0].trim()).filter(Boolean).join("; ");
  return raw;
}

async function warm(path, cookie) {
  const t0 = Date.now();
  try {
    const res = await fetch(base + path, {
      redirect: "manual",
      headers: cookie ? { cookie } : {},
    });
    const dt = Date.now() - t0;
    const ok = res.status < 500;
    console.log(`${ok ? "warm" : "FAIL"} ${path} -> ${res.status} in ${dt}ms`);
    return ok;
  } catch (e) {
    console.error(`FAIL ${path} -> ${e.message}`);
    return false;
  }
}

if (!(await waitReady())) {
  console.error("server not ready");
  process.exit(1);
}

let ok = 0;
let fail = 0;
for (const p of publicPaths) {
  (await warm(p, null)) ? ok++ : fail++;
  await sleep(30);
}

let cookie = "";
try {
  cookie = await login();
  console.log(cookie ? "login ok" : "login: no cookie");
} catch (e) {
  console.error("login failed:", e.message);
}

for (const p of authPaths) {
  (await warm(p, cookie)) ? ok++ : fail++;
  await sleep(30);
}

console.log(`prewarm done: ${ok} ok, ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);
