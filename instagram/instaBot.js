/**
 * instaBot.js (POST ONLY - custom selectors)
 * - ✅ 로그인은 사용자 수동 처리
 * - ✅ 사용자가 준 “정확한 셀렉터/텍스트”로만 업로드 플로우 수행
 *
 * 플로우:
 *  1) (홈) Create 버튼(특정 class) 클릭
 *  2) (미디어 선택) button._aswp._aswr._aswu._asw_._asx2 클릭
 *  3) (업로드) input[type=file]에 로컬 이미지 업로드
 *  4) (다음) role="button" + textContent === "다음" 인 div를 2번 클릭
 *  5) (문구) aria-label="문구를 입력하세요..." 인 div 클릭 후 텍스트 입력
 *  6) (공유하기) role="button" + textContent === "공유하기" 인 div 클릭
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

async function gotoUrl(page, url, opts = {}) {
  if (!page) throw new Error("gotoUrl: page is required");
  if (!url) throw new Error("gotoUrl: url is required");
  const { waitUntil = "domcontentloaded", timeout = 30000 } = opts;
  await page.goto(String(url), { waitUntil, timeout });
  return page;
}

async function waitForSelectorOrThrow(page, selector, timeout = 20000) {
  await page.waitForSelector(selector, { timeout });
  return selector;
}

async function clickRoleButtonDivByText(page, text, timeout = 20000) {
  const target = String(text || "").trim();
  if (!target) throw new Error("clickRoleButtonDivByText: text is required");

  const start = Date.now();
  while (Date.now() - start < timeout) {
    const clicked = await page.evaluate((t) => {
      const nodes = Array.from(document.querySelectorAll('div[role="button"]'));
      const el = nodes.find((x) => (x.textContent || "").trim() === t);
      if (!el) return false;
      el.scrollIntoView({ block: "center", inline: "center" });
      el.click();
      return true;
    }, target);

    if (clicked) return true;
    await sleep(250);
  }

  throw new Error(`clickRoleButtonDivByText timeout: "${target}"`);
}

/** ------------------------------------------------------------
 * openPage (puppeteer-extra + stealth)
 * ----------------------------------------------------------- */
async function openPage({
  profileKey = "insta_kr",
  url,
  headless = false,
  viewport = { width: 1280, height: 900 },
} = {}) {
  if (!url) throw new Error("openPage: url is required");

  const userDataDir = path.resolve(process.cwd(), ".puppeteer_profiles", String(profileKey));

  const browser = await puppeteerExtra.launch({
    headless,
    userDataDir,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--lang=ko-KR,ko"],
    defaultViewport: viewport,
  });

  const page = await browser.newPage();
  await page.setExtraHTTPHeaders({
    "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
  });

  await page.goto(String(url), { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForSelector("body", { timeout: 25000 });

  return { browser, page };
}

/** ------------------------------------------------------------
 * enterSite (login is manual)
 * ----------------------------------------------------------- */
async function enterSite({
  targetUrl = "https://www.instagram.com/",
  profileKey = "insta_kr",
  headless = false,
} = {}) {
  return openPage({ profileKey, url: targetUrl, headless });
}

/** ********************************************************************
 * ✅ ICON 기반 Create 클릭 (aria-label / svg fallback)
 * - 목표: class/aria-describedby 변동 없이 "Create(+) 아이콘"으로 찾아 클릭
 * - 방식:
 *   1) svg[aria-label="Create"] 또는 svg[aria-label="New post"] 우선
 *   2) 못 찾으면 상단 네비 영역에서 "create"로 추정되는 클릭 가능 요소 탐색
 ********************************************************************* */

/** ------------------------------------------------------------
 * ICON 기반 Create 클릭
 * ----------------------------------------------------------- */
async function clickCreateByIcon(page, timeout = 30000) {
  if (!page) throw new Error("clickCreateByIcon: page is required");

  const start = Date.now();

  while (Date.now() - start < timeout) {
    const ok = await page.evaluate(() => {
      /** *******************************************************
       * 1) 가장 안정적인 케이스: svg aria-label
       ******************************************************* */
      const svg =
        document.querySelector('svg[aria-label="Create"]') ||
        document.querySelector('svg[aria-label="New post"]');

      if (svg) {
        /** 이벤트는 보통 a/button/div[role=button]에 걸림 */
        const clickable =
          svg.closest('a[role="link"]') ||
          svg.closest('button') ||
          svg.closest('div[role="button"]') ||
          svg;

        clickable.scrollIntoView({ block: "center", inline: "center" });
        clickable.click();
        return true;
      }

      /** *******************************************************
       * 2) fallback: "Create" 문자열을 갖는 클릭 요소 찾기
       * - 다국어/변동 대비: create/new post/만들기/새 게시물/만들기
       ******************************************************* */
      const texts = ["create", "new post", "만들기", "새 게시물"];
      const candidates = Array.from(
        document.querySelectorAll('a[role="link"], div[role="button"], button')
      );

      const hit = candidates.find((el) => {
        const t = (el.textContent || "").trim().toLowerCase();
        return texts.some((k) => t === k || t.includes(k));
      });

      if (hit) {
        hit.scrollIntoView({ block: "center", inline: "center" });
        hit.click();
        return true;
      }

      return false;
    });

    if (ok) return true;
    await sleep(250);
  }

  throw new Error("clickCreateByIcon timeout: Create icon not found");
}

/** ------------------------------------------------------------
 * postInstaCustom(page)
 * - ✅ ICON으로 Create 클릭
 * - ✅ 미디어 선택 버튼 클릭
 * - ✅ 파일 input 대기
 * ----------------------------------------------------------- */
async function postInstaCustom(page) {
  if (!page) throw new Error("postInstaCustom: page is required");

  await gotoUrl(page, "https://www.instagram.com/", { waitUntil: "domcontentloaded" });
  await sleep(600);

  /** ✅ 1) Create: 아이콘으로 클릭 */
  await clickCreateByIcon(page, 30000);
  await sleep(700);

  return page;
}

/** ------------------------------------------------------------
 * uploadImageinInstaPostCustom(page, imagePath)
 * - ✅ input[type=file] 업로드
 * - ✅ role="button" div 중 "다음" 2회 클릭
 * ----------------------------------------------------------- */
async function uploadImageinInstaPostCustom(page, imagePath) {
  if (!page) throw new Error("uploadImageinInstaPostCustom: page is required");
  if (!imagePath) throw new Error("uploadImageinInstaPostCustom: imagePath is required");

  const absPath = path.isAbsolute(imagePath) ? imagePath : path.resolve(process.cwd(), imagePath);

  /** ✅ fs로 파일 읽기 가능 확인 */
  await fs.promises.access(absPath, fs.constants.R_OK).catch(() => {
    throw new Error(`Image not readable: ${absPath}`);
  });

  /** ✅ 업로드 */
  await waitForSelectorOrThrow(page, 'input[type="file"]', 30000);
  const input = await page.$('input[type="file"]');
  if (!input) throw new Error("file input handle not found");

  await input.uploadFile(absPath);
  await sleep(900);

  /** ✅ "다음" div[role=button] 2회 클릭 */
  await clickRoleButtonDivByText(page, "다음", 30000);
  await sleep(1000);
  await clickRoleButtonDivByText(page, "다음", 30000);
  await sleep(1000);

  return page;
}

async function typeCaptionLexical(page, caption) {
  if (!page) throw new Error("typeCaptionLexical: page is required");

  const editorSel =
    'div[role="textbox"][aria-placeholder="문구를 입력하세요..."][data-lexical-editor="true"]';

  /** 1) 에디터 대기 */
  await page.waitForSelector(editorSel, { timeout: 30000 });

  /** 2) 클릭+포커스(+ 디버그: 클릭한 div class 출력) */
  const debug = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return { ok: false, reason: "editor_not_found" };

    el.scrollIntoView({ block: "center", inline: "center" });
    el.click();
    el.focus?.();

    return { ok: true, className: el.className || "(no class)" };
  }, editorSel);

  if (!debug?.ok) throw new Error(`[caption] focus failed: ${debug?.reason || "unknown"}`);
  console.log("[DEBUG][caption] editor clicked:", debug.className);

  /** 3) 기존 텍스트 제거: Ctrl+A -> Backspace (Lexical에 가장 안전) */
  await page.keyboard.down("Control");
  await page.keyboard.press("KeyA");
  await page.keyboard.up("Control");
  await page.keyboard.press("Backspace");

  /** 4) 1차 입력: keyboard.type */
  await page.keyboard.type(String(caption || ""), { delay: 15 });

  /** 5) 입력 검증: span[data-lexical-text="true"] 에 텍스트가 들어갔는지 확인 */
  const ok = await page
    .waitForFunction(
      (sel, expected) => {
        const root = document.querySelector(sel);
        if (!root) return false;

        const span = root.querySelector('span[data-lexical-text="true"]');
        const got = (span?.textContent || "").trim();

        return got.includes(String(expected || "").trim());
      },
      { timeout: 6000 },
      editorSel,
      caption
    )
    .then(() => true)
    .catch(() => false);

  if (ok) return true;

  /** 6) 2차 fallback: "paste" 이벤트로 주입 (Lexical이 가장 잘 받아먹는 편) */
  await page.evaluate(async (sel, text) => {
    const el = document.querySelector(sel);
    if (!el) return;

    el.scrollIntoView({ block: "center", inline: "center" });
    el.click();
    el.focus?.();

    /** ClipboardEvent + DataTransfer로 paste 트리거 */
    const dt = new DataTransfer();
    dt.setData("text/plain", String(text || ""));

    const evt = new ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
      clipboardData: dt,
    });

    el.dispatchEvent(evt);
  }, editorSel, caption);

  /** 7) 최종 검증 */
  await page.waitForFunction(
    (sel, expected) => {
      const root = document.querySelector(sel);
      if (!root) return false;

      const span = root.querySelector('span[data-lexical-text="true"]');
      const got = (span?.textContent || "").trim();

      return got.includes(String(expected || "").trim());
    },
    { timeout: 8000 },
    editorSel,
    caption
  );

  return true;
}
/** ********************************************************************
 * ✅ 캡션 입력 (waitForTimeout 제거)
 * - target:
 *   div[role="textbox"][aria-placeholder="문구를 입력하세요..."]
 ********************************************************************* */
async function setCaptionAndShareCustom(page, caption) {
  if (!page) throw new Error("setCaptionAndShareCustom: page is required");

  const captionSel =
    'div:has(> div[role="textbox"][aria-placeholder="문구를 입력하세요..."])';

  /** 1) 캡션 영역 대기 */
  await page.waitForSelector(captionSel, { timeout: 30000 });

  /** 2) 클릭해서 포커스 */
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) {
      return false;
    }

    el.scrollIntoView({ block: "center", inline: "center" });
    el.click();
    return true;
  }, captionSel);

  await sleep(300);

  /** 4) 입력 */
  await typeCaptionLexical(page, caption);
  await sleep(1000);

  /** 5) 공유하기 클릭 */
  await clickRoleButtonDivByText(page, "공유하기", 30000);

  await sleep(1000);
}

/** ------------------------------------------------------------
 * one-shot: manual login → post only
 * ----------------------------------------------------------- */
async function postInstaWithImagePostOnly({
  headless = false,
  profileKey = "insta_kr",
  caption = "test",
  imagePath = "public\\assets\\image\\cat.jpg",
} = {}) {
  const { browser, page } = await enterSite({
    headless,
    profileKey,
    targetUrl: "https://www.instagram.com/",
  });

  try {
    console.log("[insta] ✅ 로그인은 수동으로 진행하세요.");
    console.log("[insta] ✅ 로그인 완료 후 runner에서 Enter로 진행하도록 구성하세요.");

    /** 이 함수는 “바로 진행” 버전(=로그인 완료 상태 가정) */
    await postInstaCustom(page);
    await uploadImageinInstaPostCustom(page, imagePath);
    await setCaptionAndShareCustom(page, caption);

    console.log("[insta] ✅ done");
    return { ok: true };
  } catch (e) {
    console.error("[insta] ❌ failed:", e?.message || e);
    return { ok: false, error: String(e?.message || e) };
  } finally {
    await browser.close().catch(() => { });
  }
}

module.exports = {
  enterSite,
  gotoUrl,

  /** ✅ custom flow exports */
  postInstaCustom,
  uploadImageinInstaPostCustom,
  setCaptionAndShareCustom,

  postInstaWithImagePostOnly,
};
