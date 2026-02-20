/**
 * redditBot.js
 */

const fs = require("fs");
const path = require("path");

/* eslint-disable no-console */
const puppeteerExtra = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
puppeteerExtra.use(StealthPlugin());

/** ------------------------------------------------------------
 * helpers
 * ----------------------------------------------------------- */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function isContextDestroyedError(e) {
  const msg = String(e?.message || e || "");
  return msg.includes("Execution context was destroyed") || msg.includes("Cannot find context with specified id");
}
function isTargetClosedError(e) {
  const msg = String(e?.message || e || "");
  return msg.includes("Target closed") || msg.includes("Protocol error") || msg.includes("DOM.describeNode");
}

async function safeWaitNetworkIdle(page, timeout = 15000) {
  try {
    await page.waitForNetworkIdle({ idleTime: 800, timeout });
  } catch {
    /** ignore */
  }
}

async function withRetry(fn, { tries = 3, delayMs = 500, tag = "retry" } = {}) {
  let lastErr = null;
  for (let i = 0; i < tries; i++) {
    try {
      // eslint-disable-next-line no-await-in-loop
      return await fn(i);
    } catch (e) {
      lastErr = e;
      const retryable =
        isFrameDetachedError(e) || isContextDestroyedError(e) || isTargetClosedError(e);

      console.log(`[reddit][${tag}] fail(${i + 1}/${tries}):`, String(e?.message || e || ""));

      if (!retryable || i === tries - 1) break;
      // eslint-disable-next-line no-await-in-loop
      await sleep(delayMs);
    }
  }
  throw lastErr;
}

function ensureDir(dirPath) {
  try {
    fs.mkdirSync(dirPath, { recursive: true });
  } catch {
    /** ignore */
  }
}

/**
 * ✅ 항상 temp profile 경로 생성
 * - profileKey는 "폴더명 prefix"로만 사용
 * - base는 프로젝트 내부 .puppeteer_profiles (OneDrive 밖이면 더 안전)
 */
function resolveTempUserDataDir(profileKey = "reddit_kr") {
  const base = path.resolve(process.cwd(), ".puppeteer_profiles");
  ensureDir(base);

  const safeKey = String(profileKey).replace(/[^\w\-]+/g, "_");
  const dir = path.join(base, `${safeKey}__tmp__${Date.now()}__${Math.random().toString(16).slice(2)}`);
  ensureDir(dir);
  return dir;
}

/**
 * ✅ gotoUrlSafe(page, url, opts) - DETACHED FRAME 대응
 * - frame detached 발생 시: 기존 page 버리고 새 탭 생성 → 같은 설정 적용 → 재시도
 * - ⚠️ 반드시 호출부에서 `page = await gotoUrlSafe(page, url)` 로 page를 갱신해서 써야 함
 */

function isFrameDetachedError(e) {
  const msg = String(e?.message || e || "");
  return (
    msg.includes("Navigating frame was detached") ||
    msg.includes("Attempted to use detached Frame")
  );
}

async function recreatePage(page, { viewport } = {}) {
  if (!page) throw new Error("recreatePage: page is required");
  const browser = page.browser();

  /** 기존 탭은 닫고 새 탭 */
  try {
    if (!page.isClosed()) await page.close({ runBeforeUnload: false });
  } catch {
    /** ignore */
  }

  const newPage = await browser.newPage();

  /** 헤더/언어 설정 재적용 */
  await newPage.setExtraHTTPHeaders({
    "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
  });

  /** viewport 재적용(옵션) */
  if (viewport) {
    try {
      await newPage.setViewport(viewport);
    } catch {
      /** ignore */
    }
  }

  /** 진단 로그 */
  newPage.on("framedetached", () => console.log("[reddit][page] framedetached"));
  newPage.on("error", (err) => console.log("[reddit][page:error]", err?.message || err));
  newPage.on("pageerror", (err) => console.log("[reddit][page:pageerror]", err?.message || err));

  return newPage;
}

async function gotoUrlSafe(page, url, opts = {}) {
  if (!page) throw new Error("gotoUrlSafe: page is required");
  if (!url) throw new Error("gotoUrlSafe: url is required");

  const { waitUntil = "domcontentloaded", timeout = 30000, viewport } = opts;

  let lastErr = null;

  /** 최대 3회 시도: 1) 일반 goto 2) detach면 page 재생성 후 goto 3) 마지막 */
  for (let i = 0; i < 3; i++) {
    try {
      await page.goto(String(url), { waitUntil, timeout });
      return page;
    } catch (e) {
      lastErr = e;
      console.log(`[reddit][goto] fail(${i + 1}/3):`, String(e?.message || e || ""));

      /** detached면 탭을 갈아끼워야 함 */
      if (isFrameDetachedError(e)) {
        page = await recreatePage(page, { viewport });
        await sleep(350);
        continue;
      }

      /** 일반 일시 오류는 약간 쉬고 재시도 */
      await sleep(450);
    }
  }

  throw lastErr;
}

async function waitForSelectorSafe(page, selector, timeout = 20000) {
  if (!page) throw new Error("waitForSelectorSafe: page is required");
  if (!selector) throw new Error("waitForSelectorSafe: selector is required");

  return withRetry(
    async () => {
      await page.waitForSelector(selector, { timeout });
      return selector;
    },
    { tries: 3, delayMs: 400, tag: `wait:${selector}` },
  );
}

/** ------------------------------------------------------------
 * profile helpers
 * ----------------------------------------------------------- */
function resolveUserDataDir(profileKey) {
  return path.resolve(process.cwd(), ".puppeteer_profiles", String(profileKey));
}
function ensureDir(dirPath) {
  try {
    fs.mkdirSync(dirPath, { recursive: true });
  } catch {
    /** ignore */
  }
}

/** ------------------------------------------------------------
 * openPage
 * ----------------------------------------------------------- */
async function openPage({
  profileKey = "reddit_kr",
  url,
  headless = false,
  viewport = { width: 1280, height: 900 },
} = {}) {
  if (!url) throw new Error("openPage: url is required");

  /** ✅ 항상 temp 경로 */
  const userDataDir = resolveTempUserDataDir(profileKey);

  console.log("[reddit][openPage] launch with TEMP profile:", userDataDir);

  const browser = await puppeteerExtra.launch({
    headless,
    userDataDir,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--lang=ko-KR,ko",
      "--disable-features=IsolateOrigins,site-per-process",
    ],
    defaultViewport: viewport,
  });

  const page = await browser.newPage();

  await page.setExtraHTTPHeaders({
    "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
  });

  page.on("framedetached", () => console.log("[reddit][page] framedetached"));
  page.on("error", (err) => console.log("[reddit][page:error]", err?.message || err));
  page.on("pageerror", (err) => console.log("[reddit][page:pageerror]", err?.message || err));

  /** 첫 진입 */
  await gotoUrlSafe(page, url, { waitUntil: "domcontentloaded", timeout: 30000, viewport });
  await waitForSelectorSafe(page, "body", 25000).catch(async () => {
    await waitForSelectorSafe(page, "html", 25000);
  });

  return { browser, page, userDataDir };
}

async function enterSite({
  targetUrl = "https://www.reddit.com/",
  profileKey = "reddit_kr",
  headless = false,
} = {}) {
  return openPage({ profileKey, url: targetUrl, headless });
}
// async function openPage({
//   profileKey = "reddit_kr",
//   url,
//   headless = false,
//   viewport = { width: 1280, height: 900 },
//   maxLaunchAttempts = 2,
// } = {}) {
//   if (!url) throw new Error("openPage: url is required");

//   const primaryDir = resolveUserDataDir(profileKey);
//   ensureDir(primaryDir);

//   const candidates = [primaryDir, resolveUserDataDir(`${profileKey}__tmp__${Date.now()}`)];
//   let lastErr = null;

//   for (let attempt = 0; attempt < Math.min(maxLaunchAttempts, candidates.length); attempt++) {
//     const userDataDir = candidates[attempt];

//     try {
//       console.log("[reddit][openPage] launch with profile:", userDataDir);

//       const browser = await puppeteerExtra.launch({
//         headless,
//         userDataDir,
//         args: [
//           "--no-sandbox",
//           "--disable-setuid-sandbox",
//           "--disable-dev-shm-usage",
//           "--lang=ko-KR,ko",
//           "--disable-features=IsolateOrigins,site-per-process",
//         ],
//         defaultViewport: viewport,
//       });

//       const page = await browser.newPage();
//       await page.setExtraHTTPHeaders({
//         "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
//       });

//       page.on("framedetached", () => console.log("[reddit][page] framedetached"));
//       page.on("error", (err) => console.log("[reddit][page:error]", err?.message || err));
//       page.on("pageerror", (err) => console.log("[reddit][page:pageerror]", err?.message || err));

//       await gotoUrlSafe(page, url, { waitUntil: "domcontentloaded", timeout: 30000 });
//       await waitForSelectorSafe(page, "body", 25000).catch(async () => {
//         await waitForSelectorSafe(page, "html", 25000);
//       });

//       return { browser, page, userDataDir };
//     } catch (e) {
//       lastErr = e;
//       console.log("[reddit][openPage] launch failed:", e?.message || e);

//       if (attempt < candidates.length - 1) {
//         console.log("[reddit][openPage] retry with temp profile...");
//         await sleep(400);
//         continue;
//       }
//       break;
//     }
//   }

//   throw lastErr || new Error("openPage failed");
// }

async function enterSite({
  targetUrl = "https://www.reddit.com/",
  profileKey = "reddit_kr",
  headless = false,
} = {}) {
  return openPage({ profileKey, url: targetUrl, headless });
}

/** ------------------------------------------------------------
 * login
 * ----------------------------------------------------------- */
async function setFaceplateTextInputById(page, hostId, value, timeout = 20000) {
  const hostSel = `faceplate-text-input#${String(hostId)}`;
  await waitForSelectorSafe(page, hostSel, timeout);

  const res = await page.evaluate(
    (sel, val) => {
      const host = document.querySelector(sel);
      if (!host) return { ok: false, reason: "NO_HOST" };

      const root = host.shadowRoot;
      if (!root) return { ok: false, reason: "NO_SHADOW" };

      const input =
        root.querySelector("input") ||
        root.querySelector("textarea") ||
        root.querySelector('[contenteditable="true"]');

      if (!input) return { ok: false, reason: "NO_INNER_INPUT" };

      if (input.getAttribute?.("contenteditable") === "true") {
        input.focus();
        input.textContent = String(val ?? "");
        input.dispatchEvent(new InputEvent("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
        return { ok: true };
      }

      if ("value" in input) {
        input.focus();
        input.value = String(val ?? "");
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
        return { ok: true };
      }

      return { ok: false, reason: "UNKNOWN" };
    },
    hostSel,
    String(value ?? ""),
  );

  if (res?.ok) return true;

  await page.click(hostSel);
  await sleep(150);
  await page.keyboard.down("Control");
  await page.keyboard.press("KeyA");
  await page.keyboard.up("Control");
  await page.keyboard.type(String(value ?? ""), { delay: 10 });
  return true;
}

async function clickLoginButton(page, timeout = 20000) {
  const targets = ["로그인", "Log in", "Log In", "Sign in", "Sign In"];

  return withRetry(
    async () => {
      const ok = await page.evaluate((texts) => {
        const spans = Array.from(document.querySelectorAll("span"));
        const hit = spans.find((s) => texts.includes((s.textContent || "").trim()));
        if (!hit) return false;
        const btn = hit.closest("button");
        if (!btn) return false;
        btn.scrollIntoView({ block: "center", inline: "center" });
        btn.click();
        return true;
      }, targets);

      if (!ok) throw new Error("login button not found yet");
      return true;
    },
    { tries: Math.max(1, Math.ceil(timeout / 500)), delayMs: 250, tag: "clickLogin" },
  );
}

async function loginRedditAuto(page, { username, password } = {}) {
  if (!username) throw new Error("loginRedditAuto: username is required");
  if (!password) throw new Error("loginRedditAuto: password is required");

  page = await gotoUrlSafe(page, "https://www.reddit.com/login/", {
    waitUntil: "domcontentloaded",
    timeout: 30000,
    viewport: { width: 1280, height: 900 },
  });

  await setFaceplateTextInputById(page, "login-username", username, 30000);
  await sleep(150);
  await setFaceplateTextInputById(page, "login-password", password, 30000);
  await sleep(200);

  await clickLoginButton(page, 30000);
  await safeWaitNetworkIdle(page, 20000);
  await sleep(600);

  return page; // ✅ caller에게 최신 page 반환
}

/** ------------------------------------------------------------
 * community/profile picker (UPDATED: type -> click matching option)
 * ----------------------------------------------------------- */
async function clickCommunityPickerDropdown(page, timeout = 30000) {
  const hostSel = "community-picker-composer#post-submit-community-picker";
  await waitForSelectorSafe(page, hostSel, timeout);

  return withRetry(
    async () => {
      const res = await page.evaluate((sel) => {
        const host = document.querySelector(sel);
        if (!host) return { ok: false, reason: "NO_HOST" };
        const root = host.shadowRoot;
        if (!root) return { ok: false, reason: "NO_SHADOW" };

        const btn = root.querySelector("button#dropdown-button") || root.querySelector("button");
        if (!btn) return { ok: false, reason: "NO_BUTTON" };

        btn.scrollIntoView({ block: "center", inline: "center" });
        btn.click();
        return { ok: true };
      }, hostSel);

      if (!res?.ok) throw new Error(`picker dropdown click failed: ${res?.reason || "unknown"}`);
      return true;
    },
    { tries: 3, delayMs: 350, tag: "pickerDropdown" },
  );
}

/**
 * typeIntoCommunityPickerSearch(page, value)
 * - dropdown 열려있는 상태에서, shadowRoot 내 input이 있으면 거기 입력
 * - 없으면 host 클릭 후 키보드 타이핑
 */
async function typeIntoCommunityPickerSearch(page, value, timeout = 30000) {
  const v = String(value || "").trim();
  if (!v) throw new Error("typeIntoCommunityPickerSearch: value is required");

  const hostSel = "community-picker-composer#post-submit-community-picker";
  await waitForSelectorSafe(page, hostSel, timeout);

  const typed = await page.evaluate((sel, val) => {
    const host = document.querySelector(sel);
    if (!host) return { ok: false, reason: "NO_HOST" };

    /** (요청사항) host value도 채워둠 */
    try {
      host.setAttribute("value", val);
      host.value = val;
      host.dispatchEvent(new Event("input", { bubbles: true }));
      host.dispatchEvent(new Event("change", { bubbles: true }));
    } catch {
      /** ignore */
    }

    const root = host.shadowRoot;
    if (!root) {
      return {
        ok: true,
        shadowTyped: false,
        valueAttr: host.getAttribute("value") || "",
        valueProp: host.value || "",
      };
    }

    const input =
      root.querySelector('input[type="text"]') ||
      root.querySelector("input") ||
      root.querySelector("textarea");

    if (!input) {
      return {
        ok: true,
        shadowTyped: false,
        valueAttr: host.getAttribute("value") || "",
        valueProp: host.value || "",
      };
    }

    input.focus();
    input.value = "";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    input.value = val;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));

    return {
      ok: true,
      shadowTyped: true,
      valueAttr: host.getAttribute("value") || "",
      valueProp: host.value || "",
    };
  }, hostSel, v);

  if (typed?.ok && typed.shadowTyped) return true;

  /** fallback: host 클릭 후 타이핑 */
  await page.click(hostSel);
  await sleep(120);

  await page.keyboard.down("Control");
  await page.keyboard.press("KeyA");
  await page.keyboard.up("Control");
  await page.keyboard.type(v, { delay: 10 });

  return true;
}


/** ------------------------------------------------------------
 * TEXT post
 * ----------------------------------------------------------- */
async function setTitleFaceplateTextarea(page, title, timeout = 30000) {
  const hostSel = 'faceplate-textarea-input[name="title"]';
  await waitForSelectorSafe(page, hostSel, timeout);

  const res = await page.evaluate(
    (sel, val) => {
      const host = document.querySelector(sel);
      if (!host) return { ok: false, reason: "NO_HOST" };

      const root = host.shadowRoot;
      if (!root) return { ok: false, reason: "NO_SHADOW" };

      const el =
        root.querySelector("textarea") ||
        root.querySelector("input") ||
        root.querySelector('[contenteditable="true"]');

      if (!el) return { ok: false, reason: "NO_INNER" };

      if (el.getAttribute?.("contenteditable") === "true") {
        el.focus();
        el.textContent = String(val ?? "");
        el.dispatchEvent(new InputEvent("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return { ok: true };
      }

      if ("value" in el) {
        el.focus();
        el.value = String(val ?? "");
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return { ok: true };
      }

      return { ok: false, reason: "UNKNOWN" };
    },
    hostSel,
    String(title ?? ""),
  );

  if (res?.ok) return true;

  await page.click(hostSel);
  await sleep(150);
  await page.keyboard.down("Control");
  await page.keyboard.press("KeyA");
  await page.keyboard.up("Control");
  await page.keyboard.type(String(title ?? ""), { delay: 8 });
  return true;
}

async function setBodyLexicalRTE(page, body, timeout = 30000) {
  const editorSel =
    'div[slot="rte"][contenteditable="true"][data-lexical-editor="true"][name="body"]';

  await waitForSelectorSafe(page, editorSel, timeout);

  await page.click(editorSel);
  await sleep(150);

  await page.keyboard.down("Control");
  await page.keyboard.press("KeyA");
  await page.keyboard.up("Control");
  await page.keyboard.press("Backspace");
  await sleep(80);

  const text = String(body ?? "");
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    // eslint-disable-next-line no-await-in-loop
    await page.keyboard.type(lines[i], { delay: 6 });
    if (i < lines.length - 1) {
      // eslint-disable-next-line no-await-in-loop
      await page.keyboard.press("Enter");
    }
  }

  return true;
}

async function clickSubmitPostButton(page, timeout = 30000) {
  if (!page) throw new Error("clickSubmitPostButton: page is required");

  const start = Date.now();

  while (Date.now() - start < timeout) {
    // eslint-disable-next-line no-await-in-loop
    const res = await page.evaluate(() => {
      const host = document.querySelector("r-post-form-submit-button#submit-post-button");
      const root = host?.shadowRoot;

      /** 1) 가장 확실: host shadowRoot */
      let btn = root?.querySelector("button#inner-post-submit-button");

      /** 2) fallback: 혹시 메인 DOM에 있을 때 */
      if (!btn) btn = document.querySelector("button#inner-post-submit-button");

      if (!btn) return { ok: false, reason: "NOT_FOUND" };

      /** disabled 체크 */
      const ariaDisabled = (btn.getAttribute("aria-disabled") || "").toLowerCase() === "true";
      const disabled = !!btn.disabled;

      if (disabled || ariaDisabled) return { ok: false, reason: "DISABLED" };

      btn.scrollIntoView({ block: "center", inline: "center" });
      btn.click();

      return { ok: true, reason: "CLICKED" };
    });

    if (res?.ok) {
      console.log("[reddit][post] submit clicked");
      return true;
    }

    // eslint-disable-next-line no-await-in-loop
    await sleep(250);
  }

  throw new Error("clickSubmitPostButton timeout: submit button not found/clickable");
}

async function createTextPost(page, { pickValue, title, body } = {}) {
  if (!page) throw new Error("createTextPost: page is required");
  if (!pickValue) throw new Error("createTextPost: pickValue is required");

  const raw = String(pickValue).trim();
  let submitUrl;

  if (raw.startsWith("u/")) {
    const username = raw.replace(/^u\//, "");
    submitUrl = `https://www.reddit.com/user/${encodeURIComponent(username)}/submit/?type=TEXT`;
  } else if (raw.startsWith("r/")) {
    const subreddit = raw.replace(/^r\//, "");
    submitUrl = `https://www.reddit.com/r/${encodeURIComponent(subreddit)}/submit/?type=TEXT`;
  } else {
    throw new Error('createTextPost: pickValue must start with "u/" or "r/"');
  }

  console.log("[reddit][post] direct submit url:", submitUrl);

  page = await gotoUrlSafe(page, submitUrl, {
    waitUntil: "domcontentloaded",
    timeout: 30000,
    viewport: { width: 1280, height: 900 },
  });

  await safeWaitNetworkIdle(page, 12000);
  await sleep(600);

  await setTitleFaceplateTextarea(page, title, 30000);
  await sleep(200);

  await setBodyLexicalRTE(page, body, 30000);
  await sleep(300);

  await clickSubmitPostButton(page, 30000);
  await safeWaitNetworkIdle(page, 20000);
  await sleep(800);

  return page; // ✅
}

/** ------------------------------------------------------------
 * search / subreddit (기존 유지)
 * ----------------------------------------------------------- */
function buildSearchUrl(keyword) {
  const q = String(keyword || "")
    .trim()
    .split(/\s+/g)
    .filter(Boolean)
    .join("+");
  return `https://www.reddit.com/search/?q=${q}`;
}

async function searchAndScroll(page, { keyword, rounds = 4, delayMs = 900 } = {}) {
  if (!keyword) throw new Error("searchAndScroll: keyword is required");

  await gotoUrlSafe(page, buildSearchUrl(keyword), {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });

  await safeWaitNetworkIdle(page, 15000);

  for (let i = 0; i < rounds; i++) {
    // eslint-disable-next-line no-await-in-loop
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    // eslint-disable-next-line no-await-in-loop
    await sleep(delayMs);
    // eslint-disable-next-line no-await-in-loop
    await safeWaitNetworkIdle(page, 8000);
    console.log(`[reddit][search] scroll ${i + 1}/${rounds}`);
  }

  return true;
}

async function enterSubreddit(page, subredditName) {
  if (!subredditName) throw new Error("enterSubreddit: subredditName is required");

  const url = `https://www.reddit.com/r/${encodeURIComponent(String(subredditName))}/`;
  await gotoUrlSafe(page, url, { waitUntil: "domcontentloaded", timeout: 30000 });
  await safeWaitNetworkIdle(page, 12000);
  return true;
}

/**
 * ✅ focusCommentComposerEditor(page)
 * - shreddit-simple-composer 를 찾고
 * - shadowRoot 내부의 div[role="textbox"][contenteditable="true"]를 클릭/포커스
 * - 성공 시 true, 실패 시 throw
 */
async function focusCommentComposerEditor(page, { timeout = 30000 } = {}) {
  const start = Date.now();

  while (Date.now() - start < timeout) {
    // eslint-disable-next-line no-await-in-loop
    const res = await page.evaluate(() => {
      const hosts = Array.from(document.querySelectorAll("shreddit-simple-composer"));
      if (!hosts.length) return { ok: false, reason: "NO_HOST" };

      // 1) "댓글 composer"로 보이는 host 우선순위: placeholder/aria-describedby 기반
      const pick =
        hosts.find((h) => (h.getAttribute("aria-describedby") || "").includes("comment-composer")) ||
        hosts.find((h) => (h.getAttribute("placeholder") || "").includes("대화에 참여")) ||
        hosts[0];

      const root = pick.shadowRoot;
      if (!root) return { ok: false, reason: "NO_SHADOW" };

      // 2) 스샷 기준 입력 div
      const editor =
        root.querySelector('div[role="textbox"][contenteditable="true"]') ||
        root.querySelector('div[contenteditable="true"][role="textbox"]');

      if (!editor) return { ok: false, reason: "NO_EDITOR" };

      // 3) 클릭/포커스 (여기가 "여기 들어가야 해" 지점)
      try {
        editor.scrollIntoView({ block: "center", inline: "center" });
      } catch {}
      try {
        editor.focus();
      } catch {}
      try {
        editor.click();
      } catch {}

      const aria = editor.getAttribute("aria-label") || "";
      const aplace = editor.getAttribute("aria-placeholder") || "";

      return { ok: true, ariaLabel: aria, ariaPlaceholder: aplace };
    });

    if (res?.ok) {
      console.log("[reddit][comment] editor focused:", res);
      return true;
    }

    // eslint-disable-next-line no-await-in-loop
    await sleep(250);
  }

  throw new Error("focusCommentComposerEditor timeout: shreddit-simple-composer editor not found");
}


/**
 * clickCommentsActionButton(page)
 * - data-post-click-location="comments-button" 버튼 클릭
 * - name="comments-action-button" fallback
 */
async function clickCommentsActionButton(page, timeout = 15000) {
  const start = Date.now();

  while (Date.now() - start < timeout) {
    console.log("[reddit][comment] trying to click comments button...");

    // eslint-disable-next-line no-await-in-loop
    const res = await page.evaluate(() => {
      /** BFS로 document + shadowRoot 전부 탐색 */
      const roots = [document];
      const seen = new Set();

      const findButton = () => {
        for (let i = 0; i < roots.length; i++) {
          const root = roots[i];
          if (!root || seen.has(root)) continue;
          seen.add(root);

          /** 1) 이 root에서 먼저 찾기 */
          const btn =
            root.querySelector?.('button[data-post-click-location="comments-button"]') ||
            root.querySelector?.('button[name="comments-action-button"]');

          if (btn) return { btn, root };

          /** 2) shadowRoot 가진 엘리먼트들을 roots에 추가 */
          const all = root.querySelectorAll ? root.querySelectorAll("*") : [];
          for (const el of all) {
            if (el && el.shadowRoot) roots.push(el.shadowRoot);
          }
        }
        return { btn: null, root: null };
      };

      const { btn } = findButton();
      if (!btn) {
        return {
          ok: false,
          reason: "NOT_FOUND",
          url: location.href,
          title: document.title,
        };
      }

      const ariaDisabled = (btn.getAttribute("aria-disabled") || "").toLowerCase() === "true";
      const disabled = !!btn.disabled;

      btn.scrollIntoView({ block: "center", inline: "center" });

      /** disabled이면 클릭하지 말고 진단만 반환 */
      if (disabled || ariaDisabled) {
        return {
          ok: false,
          reason: "DISABLED",
          url: location.href,
          title: document.title,
          text: (btn.textContent || "").trim(),
          ariaDisabled,
          disabled,
        };
      }

      btn.click();

      return {
        ok: true,
        reason: "CLICKED",
        url: location.href,
        title: document.title,
        text: (btn.textContent || "").trim(),
        ariaDisabled,
        disabled,
      };
    });

    console.log("[reddit][comment] clickCommentsActionButton result:", res);

    if (res?.ok) return true;

    /** NOT_FOUND면 페이지 자체가 다른 레이아웃일 확률 큼 → URL/타이틀로 확인 */
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 350));
  }

  throw new Error("clickCommentsActionButton timeout");
}


async function createComment(page, { url, commentText } = {}) {
  if (!page) throw new Error("createComment: page is required");

  const targetUrl = String(url || "").trim();
  const text = String(commentText || "").trim();
  if (!targetUrl) throw new Error("createComment: url is required");
  if (!text) throw new Error("createComment: commentText is required");

  /** 1) target로 이동 */
  page = await gotoUrlSafe(page, targetUrl, {
    waitUntil: "domcontentloaded",
    timeout: 30000,
    viewport: { width: 1280, height: 900 },
  });

  await safeWaitNetworkIdle(page, 12000);
  await sleep(700);

  /** 2) "댓글로 이동" 버튼 클릭 (이미 구현된 함수 사용) */
  await clickCommentsActionButton(page, 15000);
  await safeWaitNetworkIdle(page, 10000);
  await sleep(700);

  /** 3) 댓글 섹션으로 확실히 스크롤 (lazy mount 유도) */
  await scrollToCommentsArea(page, { rounds: 8, step: 900 });
  await safeWaitNetworkIdle(page, 10000);
  await sleep(600);

  /** 4) ✅ editor 포커스: 태그명 의존 X, shadow BFS + aria-placeholder/label 엄격필터 */
  await focusCommentEditorDeepStrict(page, { timeout: 25000 });
  await sleep(150);

  /** 5) 입력 */
  await setCommentTextByKeyboard(page, text);
  await sleep(250);

  /** 6) 댓글 버튼 클릭 */
  await clickCommentSubmitButtonDeep(page, 20000);
  await safeWaitNetworkIdle(page, 15000);
  await sleep(800);

  return page;
}

async function safeWaitNetworkIdle(page, timeout = 12000) {
  try {
    await page.waitForNetworkIdle({ idleTime: 800, timeout });
  } catch {
    /** ignore */
  }
}

/**
 * scrollToCommentsArea(page)
 * - "댓글로 이동" 이후 실제 댓글 섹션 근처로 확실히 스크롤
 * - (1) 흔한 앵커/섹션 후보로 scrollIntoView 시도
 * - (2) 실패 시 페이지를 조금씩 내리며 컴포저 lazy-mount 유도
 */
async function scrollToCommentsArea(page, { rounds = 8, step = 900 } = {}) {
  for (let i = 0; i < rounds; i++) {
    // eslint-disable-next-line no-await-in-loop
    const moved = await page.evaluate(() => {
      const candidates = [
        "#comment-tree",
        "#comments",
        "[data-testid='comment-tree']",
        "shreddit-comment-tree",
        "[aria-label*='댓글']",
        "[id*='comment']",
      ];

      for (const sel of candidates) {
        const el = document.querySelector(sel);
        if (el) {
          el.scrollIntoView({ block: "start", inline: "nearest" });
          return true;
        }
      }

      // 못 찾으면 false
      return false;
    });

    // eslint-disable-next-line no-await-in-loop
    await sleep(350);

    if (moved) {
      // 스크롤 이동했으면 렌더링 여유
      // eslint-disable-next-line no-await-in-loop
      await safeWaitNetworkIdle(page, 8000);
      // eslint-disable-next-line no-await-in-loop
      await sleep(450);
      return true;
    }

    // 후보를 못 찾으면 강제로 조금씩 스크롤해서 lazy mount 유도
    // eslint-disable-next-line no-await-in-loop
    await page.evaluate((dy) => window.scrollBy(0, dy), step);
    // eslint-disable-next-line no-await-in-loop
    await sleep(350);
  }

  return false;
}

/**
 * focusCommentEditorDeepStrict(page)
 * - ✅ 핵심: "특정 태그명"에 의존하지 않음
 * - ✅ shadowRoot 전체에서 contenteditable textbox를 찾되,
 *    aria-placeholder/aria-label에 댓글 입력문구가 있는 것만 통과 (엄격)
 *
 * 찾는 대상(우선순위):
 * 1) aria-placeholder에 "대화에 참여" 포함
 * 2) aria-label에 "콘텐츠 작성 입력창" 등 포함
 * 3) placeholder/name 기반 shreddit-simple-composer host가 있으면 그 shadowRoot 내부 우선
 */
async function focusCommentEditorDeepStrict(page, { timeout = 25000 } = {}) {
  const start = Date.now();

  while (Date.now() - start < timeout) {
    // eslint-disable-next-line no-await-in-loop
    const res = await page.evaluate(() => {
      /** BFS roots: document + all shadowRoots */
      const roots = [document];
      const seen = new Set();

      const pushShadowRoots = (root) => {
        if (!root?.querySelectorAll) return;
        const all = root.querySelectorAll("*");
        for (const el of all) {
          if (el && el.shadowRoot) roots.push(el.shadowRoot);
        }
      };

      const matchEditor = (el) => {
        if (!el) return false;

        const role = (el.getAttribute?.("role") || "").toLowerCase();
        const ce = el.getAttribute?.("contenteditable");
        if (role !== "textbox") return false;
        if (ce !== "" && ce !== "true") return false; // contenteditable=true 또는 빈값

        const ariaPh = (el.getAttribute?.("aria-placeholder") || "").trim();
        const ariaLabel = (el.getAttribute?.("aria-label") || "").trim();

        const ok =
          ariaPh.includes("대화에 참여") ||
          ariaPh.includes("댓글") ||
          ariaLabel.includes("콘텐츠 작성") ||
          ariaLabel.includes("댓글") ||
          ariaLabel.includes("입력");

        return ok;
      };

      /** 1) host 우선 탐색: shreddit-simple-composer류 */
      const hostCandidates = Array.from(
        document.querySelectorAll(
          "shreddit-simple-composer, shreddit-comment-composer, shreddit-composer",
        ),
      );

      for (const host of hostCandidates) {
        const root = host.shadowRoot;
        if (!root) continue;

        const editor =
          root.querySelector('div[role="textbox"][contenteditable="true"]') ||
          root.querySelector('div[role="textbox"][contenteditable]');

        if (matchEditor(editor)) {
          try {
            editor.scrollIntoView({ block: "center", inline: "center" });
          } catch {}
          try {
            editor.focus();
          } catch {}
          try {
            editor.click();
          } catch {}
          return {
            ok: true,
            via: "HOST_SHADOW",
            ariaPlaceholder: editor.getAttribute("aria-placeholder") || "",
            ariaLabel: editor.getAttribute("aria-label") || "",
          };
        }
      }

      /** 2) 전체 shadow BFS로 editor 찾기 */
      for (let i = 0; i < roots.length; i++) {
        const root = roots[i];
        if (!root || seen.has(root)) continue;
        seen.add(root);

        // 현재 root에서 contenteditable textbox 후보
        const editors = root.querySelectorAll
          ? root.querySelectorAll('div[role="textbox"][contenteditable], div[role="textbox"][contenteditable="true"]')
          : [];

        for (const ed of editors) {
          if (!matchEditor(ed)) continue;

          try {
            ed.scrollIntoView({ block: "center", inline: "center" });
          } catch {}
          try {
            ed.focus();
          } catch {}
          try {
            ed.click();
          } catch {}

          return {
            ok: true,
            via: "DEEP_BFS",
            ariaPlaceholder: ed.getAttribute("aria-placeholder") || "",
            ariaLabel: ed.getAttribute("aria-label") || "",
          };
        }

        pushShadowRoots(root);
      }

      return { ok: false, reason: "NO_EDITOR", url: location.href, title: document.title };
    });

    if (res?.ok) {
      console.log("[reddit][comment] editor focused:", res);
      return true;
    }

    // 아직 렌더 안 된 경우가 많아서: 조금 더 내려서 lazy-mount 유도
    // eslint-disable-next-line no-await-in-loop
    await page.evaluate(() => window.scrollBy(0, 700));
    // eslint-disable-next-line no-await-in-loop
    await sleep(350);
  }

  throw new Error("focusCommentEditorDeepStrict timeout: comment editor not found");
}

/**
 * setCommentTextByKeyboard(page, text)
 * - focus 되어있다는 전제
 */
async function setCommentTextByKeyboard(page, text) {
  const v = String(text ?? "");

  await page.keyboard.down("Control");
  await page.keyboard.press("KeyA");
  await page.keyboard.up("Control");
  await page.keyboard.press("Backspace");
  await sleep(80);

  const lines = v.split("\n");
  for (let i = 0; i < lines.length; i++) {
    // eslint-disable-next-line no-await-in-loop
    await page.keyboard.type(lines[i], { delay: 8 });
    if (i < lines.length - 1) {
      // eslint-disable-next-line no-await-in-loop
      await page.keyboard.press("Enter");
    }
  }
}

/**
 * clickCommentSubmitButtonDeep(page)
 * - ✅ shadowRoot 포함해서 "댓글" 버튼 찾기
 * - ✅ "취소/댓글"이 있는 composer footer 버튼 우선
 */
async function clickCommentSubmitButtonDeep(page, timeout = 20000) {
  const start = Date.now();

  while (Date.now() - start < timeout) {
    // eslint-disable-next-line no-await-in-loop
    const res = await page.evaluate(() => {
      const roots = [document];
      const seen = new Set();

      const pushShadowRoots = (root) => {
        if (!root?.querySelectorAll) return;
        const all = root.querySelectorAll("*");
        for (const el of all) {
          if (el && el.shadowRoot) roots.push(el.shadowRoot);
        }
      };

      const isClickable = (btn) => {
        const ariaDisabled = (btn.getAttribute?.("aria-disabled") || "").toLowerCase() === "true";
        const disabled = !!btn.disabled;
        return !(disabled || ariaDisabled);
      };

      for (let i = 0; i < roots.length; i++) {
        const root = roots[i];
        if (!root || seen.has(root)) continue;
        seen.add(root);

        const btns = root.querySelectorAll ? Array.from(root.querySelectorAll("button")) : [];
        const hit = btns.find((b) => (b.textContent || "").trim() === "댓글");

        if (hit && isClickable(hit)) {
          try {
            hit.scrollIntoView({ block: "center", inline: "center" });
          } catch {}
          hit.click();
          return { ok: true, via: "DEEP_BFS", text: (hit.textContent || "").trim() };
        }

        pushShadowRoots(root);
      }

      return { ok: false, reason: "NO_SUBMIT" };
    });

    if (res?.ok) {
      console.log("[reddit][comment] submit clicked:", res);
      return true;
    }

    // eslint-disable-next-line no-await-in-loop
    await sleep(250);
  }

  throw new Error("clickCommentSubmitButtonDeep timeout: submit button not found/clickable");
}

module.exports = {
  enterSite,
  openPage,

  gotoUrlSafe,
  waitForSelectorSafe,
  safeWaitNetworkIdle,
  sleep,

  loginRedditAuto,

  searchAndScroll,
  enterSubreddit,

  /** picker exports */
  clickCommunityPickerDropdown,
  typeIntoCommunityPickerSearch,

  /** post */
  createTextPost,

  /** comment */
  createComment,
  clickCommentSubmitButtonDeep,
  focusCommentComposerEditor,
  setCommentTextByKeyboard,
};