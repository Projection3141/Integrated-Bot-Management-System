/* ============================================================
FILE: chromiumUtil.js
============================================================ */

/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");
const { execFile } = require("child_process");

const MAX_BROWSERS = 4;
const PROFILES_PATH = path.join(__dirname, "profiles.json");

/** ---------------------------
 * Profiles (single JSON) in-memory
 * ---------------------------
 */
const PROFILE_STORE = {
  filePath: PROFILES_PATH,
  loadedAt: 0,
  defaultKey: "kr",
  globals: {},
  profiles: {},
};

function loadProfiles(filePath = PROFILE_STORE.filePath) {
  const abs = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
  const txt = fs.readFileSync(abs, "utf8");
  const parsed = JSON.parse(txt);

  PROFILE_STORE.filePath = abs;
  PROFILE_STORE.loadedAt = Date.now();
  PROFILE_STORE.defaultKey = typeof parsed?.default === "string" ? parsed.default : "kr";
  PROFILE_STORE.globals = parsed?.globals && typeof parsed.globals === "object" ? parsed.globals : {};
  PROFILE_STORE.profiles = parsed?.profiles && typeof parsed.profiles === "object" ? parsed.profiles : {};
}

loadProfiles(PROFILES_PATH);

function reloadProfiles() {
  loadProfiles(PROFILE_STORE.filePath);
  return { loadedAt: PROFILE_STORE.loadedAt, filePath: PROFILE_STORE.filePath };
}

function listProfiles() {
  return Object.keys(PROFILE_STORE.profiles || {});
}

function getGlobals() {
  return { ...PROFILE_STORE.globals };
}

function getProfile(key, override = null) {
  const k = (key && String(key)) || PROFILE_STORE.defaultKey;
  const base = PROFILE_STORE.profiles[k] || PROFILE_STORE.profiles[PROFILE_STORE.defaultKey] || {};

  const profile = {
    key: k,
    locale: base.locale,
    timezone: base.timezone,
    acceptLanguage: base.acceptLanguage,
    chromeArgs: Array.isArray(base.chromeArgs) ? base.chromeArgs : [],
  };

  if (override && typeof override === "object") {
    return {
      ...profile,
      ...override,
      key: override.key || profile.key,
      chromeArgs: Array.isArray(override.chromeArgs) ? override.chromeArgs : profile.chromeArgs,
    };
  }
  return profile;
}

/** ---------------------------
 * Browser cache (LRU, MAX 4) + telemetry
 * ---------------------------
 */
const BROWSER_CACHE = new Map();

function baseChromeArgs({ width, height }) {
  const g = getGlobals();
  const base = Array.isArray(g.baseChromeArgs) ? g.baseChromeArgs : [];
  return [`--window-size=${width},${height}`, ...base];
}

function getWindowsWorkingSetBytes(pid) {
  return new Promise((resolve) => {
    const psArgs = [
      "-NoProfile",
      "-Command",
      `(Get-Process -Id ${pid} -ErrorAction SilentlyContinue).WorkingSet64`,
    ];
    execFile("powershell.exe", psArgs, { windowsHide: true }, (err, stdout) => {
      if (err) return resolve(null);
      const n = Number(String(stdout || "").trim());
      if (!Number.isFinite(n) || n <= 0) return resolve(null);
      resolve(n);
    });
  });
}

function fmtBytes(bytes) {
  if (!Number.isFinite(bytes)) return "n/a";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(i === 0 ? 0 : 2)}${units[i]}`;
}

function startMemoryReporter(ctx, intervalMs) {
  const timer = setInterval(async () => {
    const mu = process.memoryUsage();
    const nodeLine =
      `NODE rss=${fmtBytes(mu.rss)} heapUsed=${fmtBytes(mu.heapUsed)} ` +
      `heapTotal=${fmtBytes(mu.heapTotal)} ext=${fmtBytes(mu.external)} ` +
      `arrayBuffers=${fmtBytes(mu.arrayBuffers)}`;

    const pid = ctx.getPid?.();
    let chromeLine = "CHROME ws=n/a (pid n/a)";
    if (pid) {
      const ws = await getWindowsWorkingSetBytes(pid);
      chromeLine = `CHROME ws=${fmtBytes(ws)} (pid ${pid})`;
    }

    console.log(`[MEM ${new Date().toISOString()}] ${nodeLine} | ${chromeLine}`);
  }, intervalMs);

  timer.unref?.();
  return () => clearInterval(timer);
}

function touchLRU(key) {
  const entry = BROWSER_CACHE.get(key);
  if (!entry) return;
  entry.lastUsedAt = Date.now();
  BROWSER_CACHE.delete(key);
  BROWSER_CACHE.set(key, entry);
}

async function evictKey(key) {
  const entry = BROWSER_CACHE.get(key);
  if (!entry) return;
  BROWSER_CACHE.delete(key);

  try { entry.memReporterStop?.(); } catch (_) {}
  try { await entry.browser.close(); } catch (_) {}
}

async function enforceMaxBrowsers() {
  while (BROWSER_CACHE.size > MAX_BROWSERS) {
    const lruKey = BROWSER_CACHE.keys().next().value;
    await evictKey(lruKey);
  }
}

/** ---------------------------
 * Launch / Page
 * ---------------------------
 */
function pickDefaultsFromGlobals() {
  const g = getGlobals();
  return {
    headless: typeof g.headless === "boolean" ? g.headless : false,
    width: Number.isFinite(g.width) ? g.width : 1600,
    height: Number.isFinite(g.height) ? g.height : 1500,
    enableMemReport: typeof g.enableMemReport === "boolean" ? g.enableMemReport : true,
    memReportIntervalMs: Number.isFinite(g.memReportIntervalMs) ? g.memReportIntervalMs : 30000,
    ui: g.ui && typeof g.ui === "object" ? g.ui : {},
    mobile: g.mobile && typeof g.mobile === "object" ? g.mobile : {},
  };
}

async function getBrowser(opts = {}) {
  const d = pickDefaultsFromGlobals();

  const {
    profileKey,
    profileOverride,
    headless = d.headless,
    width = d.width,
    height = d.height,
    enableMemReport = d.enableMemReport,
    memReportIntervalMs = d.memReportIntervalMs,
  } = opts;

  const profile = getProfile(profileKey, profileOverride);
  const cacheKey = profile.key;

  const cached = BROWSER_CACHE.get(cacheKey);
  if (cached?.browser?.isConnected?.()) {
    touchLRU(cacheKey);
    if (enableMemReport && !cached.memReporterStop) {
      cached.memReporterStop = startMemoryReporter({ getPid: () => cached.pid }, memReportIntervalMs);
    }
    return { browser: cached.browser, profile, pid: cached.pid || null };
  }

  const g = getGlobals();
  const ui = g.ui && typeof g.ui === "object" ? g.ui : {};

  const args = [
    ...baseChromeArgs({ width, height }),
    ...(Array.isArray(profile.chromeArgs) ? profile.chromeArgs : []),
  ];

  const browser = await puppeteer.launch({
    headless,
    args,
    /** 브라우저 “잘 보이게”: start-maximized + defaultViewport null */
    defaultViewport: ui.defaultViewportNull ? null : { width, height },
  });

  const pid = browser.process?.()?.pid ?? null;

  const entry = {
    browser,
    pid,
    createdAt: Date.now(),
    lastUsedAt: Date.now(),
    memReporterStop: null,
  };

  if (enableMemReport) {
    entry.memReporterStop = startMemoryReporter({ getPid: () => entry.pid }, memReportIntervalMs);
  }

  BROWSER_CACHE.set(cacheKey, entry);
  await enforceMaxBrowsers();

  return { browser, profile, pid };
}

async function applyMobileIfEnabled(page) {
  const g = getGlobals();
  const m = g.mobile && typeof g.mobile === "object" ? g.mobile : {};
  if (!m.enabled) return;

  if (m.userAgent) {
    try { await page.setUserAgent(String(m.userAgent)); } catch (_) {}
  }

  if (m.viewport && typeof m.viewport === "object") {
    try { await page.setViewport(m.viewport); } catch (_) {}
  }
}

async function openPage(opts = {}) {
  const { url = "https://www.google.com" } = opts;

  const { browser, profile, pid } = await getBrowser(opts);
  const page = await browser.newPage();

  if (profile.acceptLanguage) {
    await page.setExtraHTTPHeaders({ "Accept-Language": profile.acceptLanguage });
  }

  if (profile.timezone) {
    try { await page.emulateTimezone(profile.timezone); } catch (_) {}
  }

  /** 모바일 베이스(글로벌) */
  await applyMobileIfEnabled(page);

  await page.goto(url, { waitUntil: "domcontentloaded" });

  touchLRU(profile.key);
  return { browser, page, profile, pid };
}

async function closeProfile(profileKey) {
  const key = profileKey || PROFILE_STORE.defaultKey;
  await evictKey(key);
}

async function closeAll() {
  const keys = Array.from(BROWSER_CACHE.keys());
  await Promise.allSettled(keys.map((k) => evictKey(k)));
}

function cacheInfo() {
  return Array.from(BROWSER_CACHE.entries()).map(([key, e]) => ({
    key,
    pid: e.pid || null,
    createdAt: e.createdAt,
    lastUsedAt: e.lastUsedAt,
    memReportEnabled: !!e.memReporterStop,
  }));
}

module.exports = {
  reloadProfiles,
  listProfiles,
  getGlobals,
  getProfile,

  getBrowser,
  openPage,
  closeProfile,
  closeAll,

  cacheInfo,
  MAX_BROWSERS,
};
