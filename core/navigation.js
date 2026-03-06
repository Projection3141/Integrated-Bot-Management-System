/**
 * core/navigation.js
 *
 * =============================================================================
 * 공통 이동 / 재시도 유틸
 * =============================================================================
 *
 * 변경 사항:
 *  1) recreatePage()에서 old page를 먼저 닫지 않고 새 페이지를 먼저 연다.
 *  2) browser가 이미 죽었으면 더 명확한 에러를 던진다.
 * =============================================================================
 */

const { sleep } = require("./helpers");

function errorMessage(e) {
  return String(e?.message || e || "");
}

function isFrameDetachedError(e) {
  const msg = errorMessage(e);
  return (
    msg.includes("Navigating frame was detached") ||
    msg.includes("Attempted to use detached Frame")
  );
}

function isContextDestroyedError(e) {
  const msg = errorMessage(e);
  return (
    msg.includes("Execution context was destroyed") ||
    msg.includes("Cannot find context with specified id")
  );
}

function isTargetClosedError(e) {
  const msg = errorMessage(e);
  return (
    msg.includes("Target closed") ||
    msg.includes("Protocol error") ||
    msg.includes("DOM.describeNode")
  );
}

async function withRetry(fn, { tries = 3, delayMs = 500, tag = "retry" } = {}) {
  let lastErr = null;

  for (let i = 0; i < tries; i += 1) {
    try {
      return await fn(i);
    } catch (e) {
      lastErr = e;

      const retryable =
        isFrameDetachedError(e) ||
        isContextDestroyedError(e) ||
        isTargetClosedError(e);

      console.log(`[bot][${tag}] fail(${i + 1}/${tries}):`, errorMessage(e));

      if (!retryable || i === tries - 1) break;
      await sleep(delayMs);
    }
  }

  throw lastErr;
}

async function safeWaitNetworkIdle(page, timeout = 15000) {
  try {
    await page.waitForNetworkIdle({ idleTime: 800, timeout });
  } catch {}
}

async function waitForSelectorSafe(page, selector, timeout = 20000) {
  return withRetry(
    async () => {
      await page.waitForSelector(selector, { timeout });
      return selector;
    },
    { tries: 3, delayMs: 400, tag: `wait:${selector}` },
  );
}

/**
 * recreatePage()
 *
 * 핵심 수정:
 *  - browser.newPage()를 먼저 시도
 *  - 그 다음 old page를 닫는다
 *  - browser가 끊겨 있으면 명확히 에러 발생
 */
async function recreatePage(page, meta = {}) {
  if (!page) throw new Error("recreatePage: page is required");

  const browser = page.browser();

  if (!browser?.isConnected?.()) {
    throw new Error("BROWSER_DISCONNECTED");
  }

  const {
    viewport,
    extraHTTPHeaders,
    timezone,
    tag = "page",
  } = meta;

  const newPage = await browser.newPage();

  if (extraHTTPHeaders && typeof extraHTTPHeaders === "object") {
    try {
      await newPage.setExtraHTTPHeaders(extraHTTPHeaders);
    } catch {}
  }

  if (viewport) {
    try {
      await newPage.setViewport(viewport);
    } catch {}
  }

  if (timezone) {
    try {
      await newPage.emulateTimezone(timezone);
    } catch {}
  }

  newPage.on("framedetached", () => console.log(`[bot][${tag}] framedetached`));
  newPage.on("error", (err) => console.log(`[bot][${tag}:error]`, err?.message || err));
  newPage.on("pageerror", (err) => console.log(`[bot][${tag}:pageerror]`, err?.message || err));

  newPage.__botMeta = {
    viewport,
    extraHTTPHeaders,
    timezone,
    tag,
  };

  try {
    if (!page.isClosed()) {
      await page.close({ runBeforeUnload: false });
    }
  } catch {}

  return newPage;
}

async function gotoUrlSafe(page, url, opts = {}) {
  const {
    waitUntil = "domcontentloaded",
    timeout = 30000,
  } = opts;

  let lastErr = null;

  for (let i = 0; i < 3; i += 1) {
    try {
      await page.goto(String(url), { waitUntil, timeout });
      return page;
    } catch (e) {
      lastErr = e;
      console.log(`[bot][goto] fail(${i + 1}/3):`, errorMessage(e));

      if (isFrameDetachedError(e)) {
        page = await recreatePage(page, page.__botMeta || {});
        await sleep(350);
        continue;
      }

      await sleep(450);
    }
  }

  throw lastErr;
}

module.exports = {
  withRetry,
  safeWaitNetworkIdle,
  waitForSelectorSafe,
  gotoUrlSafe,
  recreatePage,
  isFrameDetachedError,
  isContextDestroyedError,
  isTargetClosedError,
};