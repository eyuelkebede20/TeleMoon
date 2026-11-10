import { cfg } from "./config.js";
import { getSetting, setSetting } from "./db.js";

const state = {
  enabled: cfg.pingEnabled,
  intervalMin: cfg.pingIntervalMin,
  targetUrl: cfg.pingUrl || "",
  isCustomUrl: Boolean(cfg.pingUrl),
  lastPingAt: null,
  lastStatus: null,
  lastDurationMs: null,
  pingCount: 0,
  failCount: 0,
  timer: null,
};

function normalizePingUrl(base) {
  if (!base) return "";
  let clean = base.trim().replace(/\/+$/, "");
  if (!clean.startsWith("http://") && !clean.startsWith("https://")) {
    clean = `https://${clean}`;
  }
  if (!clean.endsWith("/api/ping") && !clean.endsWith("/ping")) {
    clean = `${clean}/api/ping`;
  }
  return clean;
}

/**
 * Automatically learns the public URL from inbound HTTP requests
 * (e.g. from x-forwarded-proto + host).
 */
export function learnPublicUrl(rawUrl) {
  if (!rawUrl || state.isCustomUrl) return;
  const normalized = normalizePingUrl(rawUrl);
  if (!normalized) return;

  // Don't learn localhost or internal IP addresses as public endpoints
  if (
    normalized.includes("localhost") ||
    normalized.includes("127.0.0.1") ||
    normalized.includes("0.0.0.0")
  ) {
    return;
  }

  if (state.targetUrl !== normalized) {
    state.targetUrl = normalized;
    try {
      setSetting("public_url", normalized);
      console.log(`[keep-alive] learned public URL from request: ${normalized}`);
    } catch (_) {}
  }
}

/**
 * Execute an immediate ping to the keep-alive URL.
 */
export async function triggerPing() {
  if (!state.enabled) {
    return { ok: false, error: "keep-alive is currently disabled" };
  }

  // Determine target URL
  let target = state.targetUrl;
  if (!target) {
    const saved = getSetting("public_url");
    if (saved) {
      target = normalizePingUrl(saved);
      state.targetUrl = target;
    }
  }

  // Fallback to local server if no external URL is known yet
  const urlToPing = target || `http://localhost:${cfg.port}/api/ping`;
  const startTime = Date.now();

  try {
    const res = await fetch(urlToPing, {
      method: "GET",
      headers: {
        "User-Agent": "TeleMoon-KeepAlive/1.0 (+https://github.com/eyuelkebede20/TeleMoon)",
        "X-Keep-Alive": "1",
      },
      signal: AbortSignal.timeout(15000),
    });

    const duration = Date.now() - startTime;
    state.lastPingAt = Date.now();
    state.lastStatus = res.status;
    state.lastDurationMs = duration;
    state.pingCount++;

    if (res.ok) {
      console.log(`[keep-alive] pinged ${urlToPing} -> ${res.status} OK (${duration}ms)`);
      return { ok: true, status: res.status, durationMs: duration, url: urlToPing };
    } else {
      console.warn(`[keep-alive] pinged ${urlToPing} -> HTTP ${res.status}`);
      return { ok: false, status: res.status, durationMs: duration, url: urlToPing };
    }
  } catch (err) {
    const duration = Date.now() - startTime;
    state.lastPingAt = Date.now();
    state.lastStatus = err.name === "TimeoutError" ? "TIMEOUT" : (err.code || err.message);
    state.lastDurationMs = duration;
    state.failCount++;
    console.warn(`[keep-alive] ping to ${urlToPing} failed (${duration}ms): ${err.message}`);
    return { ok: false, error: err.message, durationMs: duration, url: urlToPing };
  }
}

/**
 * Returns current keep-alive statistics and settings.
 */
export function getKeepAliveStatus() {
  return {
    enabled: state.enabled,
    targetUrl: state.targetUrl || getSetting("public_url") || null,
    intervalMin: state.intervalMin,
    lastPingAt: state.lastPingAt,
    lastStatus: state.lastStatus,
    lastDurationMs: state.lastDurationMs,
    pingCount: state.pingCount,
    failCount: state.failCount,
    uptimeSec: Math.floor(process.uptime()),
  };
}

/**
 * Update keep-alive configuration at runtime.
 */
export function updateKeepAliveConfig({ url, enabled, intervalMin }) {
  if (typeof enabled === "boolean") {
    state.enabled = enabled;
  }
  if (typeof intervalMin === "number" && intervalMin >= 1) {
    state.intervalMin = intervalMin;
    restartTimer();
  }
  if (typeof url === "string") {
    if (url.trim()) {
      const normalized = normalizePingUrl(url);
      state.targetUrl = normalized;
      state.isCustomUrl = true;
      setSetting("public_url", normalized);
    } else {
      state.targetUrl = "";
      state.isCustomUrl = false;
      setSetting("public_url", "");
    }
  }
  return getKeepAliveStatus();
}

function restartTimer() {
  if (state.timer) {
    clearInterval(state.timer);
    state.timer = null;
  }
  if (state.enabled && state.intervalMin > 0) {
    const ms = state.intervalMin * 60 * 1000;
    state.timer = setInterval(() => {
      triggerPing().catch((e) => console.error("[keep-alive scheduled error]", e.message));
    }, ms);
    state.timer.unref?.();
  }
}

export function stopKeepAlive() {
  if (state.timer) {
    clearInterval(state.timer);
    state.timer = null;
  }
}

/**
 * Initialize the keep-alive background worker.
 */
export function startKeepAlive() {
  // Load saved setting if no env override
  if (!state.targetUrl) {
    const saved = getSetting("public_url");
    if (saved) {
      state.targetUrl = normalizePingUrl(saved);
    }
  }

  restartTimer();

  const targetDesc = state.targetUrl || "(will auto-learn from first inbound request)";
  console.log(`[keep-alive] active: pinging ${targetDesc} every ${state.intervalMin}m`);

  // Run initial test ping 15 seconds after server boots up
  const initTimer = setTimeout(() => {
    if (state.enabled) {
      triggerPing().catch(() => {});
    }
  }, 15000);
  initTimer.unref?.();
}
