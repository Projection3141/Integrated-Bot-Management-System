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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

/** ****************************************************************************
 * 공통 frame / DOM 액션 유틸
 * stale frame/handle 재사용 방지
 ******************************************************************************/

function isLocatorSupported(target) {
  return target && typeof target.locator === "function";
}

function getPageFromTarget(target) {
  if (target && typeof target.page === "function") {
    try {
      return target.page();
    } catch {
      return target;
    }
  }
  return target;
}

async function getLiveFrame(page, predicate, opts = {}) {
  if (!page) throw new Error("getLiveFrame: page is required");
  if (typeof predicate !== "function") throw new Error("getLiveFrame: predicate must be a function");

  const { timeout = 10000, pollInterval = 100, tag = "getLiveFrame" } = opts;
  const start = Date.now();

  while (Date.now() - start < timeout) {
    try {
      const frame = page.frames().find((f) => !f.isDetached() && predicate(f));
      if (frame) return frame;
    } catch (e) {
      console.log(`[bot][${tag}] frame discovery error:`, errorMessage(e));
    }
    await sleep(pollInterval);
  }

  return null;
}

async function withLiveFrame(page, predicate, task, opts = {}) {
  if (typeof task !== "function") throw new Error("withLiveFrame: task must be a function");

  const frame = await getLiveFrame(page, predicate, opts);
  if (!frame) {
    throw new Error("withLiveFrame: no live frame found");
  }

  try {
    return await task(frame);
  } catch (e) {
    if (isFrameDetachedError(e) || isContextDestroyedError(e)) {
      const nextFrame = await getLiveFrame(page, predicate, opts);
      if (nextFrame && nextFrame !== frame) {
        return await task(nextFrame);
      }
    }
    throw e;
  }
}

async function clickInFrame(target, selector, opts = {}) {
  if (!target) throw new Error("clickInFrame: target is required");
  if (!selector) throw new Error("clickInFrame: selector is required");

  const { timeout = 10000, tag = "clickInFrame" } = opts;
  if (isLocatorSupported(target)) {
    const locator = target.locator(selector);
    await locator.waitFor({ timeout });
    await locator.click();
    return;
  }

  let handle = null;
  try {
    handle = await target.waitForSelector(selector, { timeout });
    if (!handle) throw new Error(`clickInFrame: selector not found ${selector}`);
    await handle.click();
  } catch (e) {
    console.log(`[bot][${tag}] fallback click failed:`, errorMessage(e));
    throw e;
  } finally {
    if (handle && typeof handle.dispose === "function") {
      await handle.dispose();
    }
  }
}

async function fillInFrame(target, selector, value, opts = {}) {
  if (!target) throw new Error("fillInFrame: target is required");
  if (!selector) throw new Error("fillInFrame: selector is required");

  const { timeout = 10000, tag = "fillInFrame" } = opts;
  if (isLocatorSupported(target)) {
    const locator = target.locator(selector);
    await locator.waitFor({ timeout });
    await locator.fill(String(value ?? ""));
    return;
  }

  let handle = null;
  const page = getPageFromTarget(target);
  try {
    handle = await target.waitForSelector(selector, { timeout });
    if (!handle) throw new Error(`fillInFrame: selector not found ${selector}`);
    await handle.focus();
    await target.evaluate((el) => {
      if (el && "value" in el) el.value = "";
    }, handle);
    await page.keyboard.type(String(value ?? ""), { delay: 25 });
  } catch (e) {
    console.log(`[bot][${tag}] fallback fill failed:`, errorMessage(e));
    throw e;
  } finally {
    if (handle && typeof handle.dispose === "function") {
      await handle.dispose();
    }
  }
}

async function readTextInFrame(target, selector, opts = {}) {
  if (!target) throw new Error("readTextInFrame: target is required");
  if (!selector) throw new Error("readTextInFrame: selector is required");

  const { timeout = 10000 } = opts;
  if (isLocatorSupported(target)) {
    const locator = target.locator(selector);
    await locator.waitFor({ timeout });
    const text = await locator.textContent();
    return String(text || "").trim();
  }

  const handle = await target.waitForSelector(selector, { timeout });
  if (!handle) return "";
  try {
    return String(
      await target.evaluate(
        (el) => (el ? (el.textContent || el.innerText || "") : ""),
        handle
      )
    ).trim();
  } finally {
    if (typeof handle.dispose === "function") {
      await handle.dispose();
    }
  }
}

async function waitForState(page, condition, opts = {}) {
  const { timeout = 10000 } = opts;
  if (typeof condition !== "function") {
    throw new Error("waitForState: condition must be a function");
  }
  await page.waitForFunction(condition, { timeout });
}

async function gotoUrlSafe(page, url, opts = {}) {
  const {
    waitUntil = "domcontentloaded",
    timeout = 30000,
  } = opts;

  let lastErr = null;

  for (let i = 0; i < 5; i += 1) {
    try {
      await page.goto(String(url), { waitUntil, timeout });
      return page;
    } catch (e) {
      lastErr = e;
      console.log(`[bot][goto] fail(${i + 1}/3):`, errorMessage(e));

      if (isFrameDetachedError(e)) {
        // page = await recreatePage(page, page.__botMeta || {});
        await sleep(350);
        continue;
      }

      await sleep(450);
    }
  }

  throw lastErr;
}

/**
 * safeEvaluate
 *
 * 역할:
 *  - page.evaluate 실행
 *  - frame detach / context destroy 시 retry
 */
async function safeEvaluate(page, fn, ...args) {
  const lastArg = args[args.length - 1];
  const isOpts =
    lastArg &&
    typeof lastArg === "object" &&
    !Array.isArray(lastArg) &&
    ("tries" in lastArg || "delayMs" in lastArg || "tag" in lastArg);

  const opts = isOpts ? args.pop() : {};
  const {
    tries = 4,
    delayMs = 350,
    tag = "evaluate",
  } = opts;

  return withRetry(
    async () => {
      return await page.evaluate(fn, ...args);
    },
    { tries, delayMs, tag }
  );
}

/**
 * safeWaitForFunction
 *
 * 역할:
 *  - waitForFunction 실행
 *  - frame detach / context destroy 시 retry
 */
async function safeWaitForFunction(page, fn, opts = {}) {

  const {
    timeout = 30000,
    tries = 4,
    delayMs = 400,
    tag = "waitForFunction",
  } = opts;

  let lastErr = null;

  for (let i = 0; i < tries; i++) {

    try {

      await page.waitForFunction(fn, { timeout });

      return page;

    } catch (e) {

      lastErr = e;

      console.log(`[bot][${tag}] fail(${i + 1}/${tries}):`, errorMessage(e));

      if (isFrameDetachedError(e)) {

        page = await recreatePage(page, page.__botMeta || {});
        await sleep(delayMs);
        continue;

      }

      if (isContextDestroyedError(e)) {

        await sleep(delayMs);
        continue;

      }

      throw e;

    }

  }

  throw lastErr;
}

module.exports = {
  withRetry,
  safeWaitNetworkIdle,
  waitForSelectorSafe,
  gotoUrlSafe,
  safeEvaluate,
  safeWaitForFunction,
  recreatePage,
  getLiveFrame,
  withLiveFrame,
  clickInFrame,
  fillInFrame,
  readTextInFrame,
  waitForState,
  isFrameDetachedError,
  isContextDestroyedError,
  isTargetClosedError,
};