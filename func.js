/* ============================================================
FILE: a.js
============================================================ */

const fs = require("fs");
const path = require("path");

/* eslint-disable no-console */
const { openPage } = require("./chromiumUtil");

/** ------------------------------------------------------------
 * helpers
 * ----------------------------------------------------------- */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function domClick(page, selector) {
  const ok = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return false;
    el.scrollIntoView({ block: "center", inline: "center" });
    (el instanceof HTMLElement ? el : el.parentElement)?.click?.();
    return true;
  }, selector);
  if (!ok) throw new Error(`domClick failed: ${selector}`);
}

async function setValue(page, selector, value) {
  await page.waitForSelector(selector, { timeout: 20000 });
  await page.focus(selector);
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (el) el.value = "";
  }, selector);
  await page.keyboard.type(String(value), { delay: 25 });
}

/** ------------------------------------------------------------
 * internal: naver search flow
 * ----------------------------------------------------------- */
async function naverSearchWithGivenInput(page, query) {
  await page.waitForSelector("#MM_SEARCH_FAKE", { timeout: 20000 });

  await page.evaluate(() => {
    const el = document.querySelector("#MM_SEARCH_FAKE");
    if (el) el.value = "";
  });

  await page.focus("#MM_SEARCH_FAKE");
  await page.keyboard.type(query, { delay: 30 });
  await page.keyboard.press("Enter");

  await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 25000 }).catch(() => {});
}

async function clickFirstDcinsideResult(page, browser) {
  await page.waitForFunction(() => {
    const as = Array.from(document.querySelectorAll('a[href]'));
    return as.some((a) => (a.getAttribute("href") || "").includes("dcinside.com"));
  }, { timeout: 25000 });

  const popupPromise = new Promise((resolve) => page.once("popup", resolve)).catch(() => null);
  const targetCreatedPromise = new Promise((resolve) => {
    browser.once("targetcreated", async (t) => {
      try {
        const p = await t.page();
        if (p) resolve(p);
      } catch (_) {}
    });
  }).catch(() => null);

  const clicked = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('a[href]'));
    const target =
      links.find((a) => (a.getAttribute("href") || "").includes("m.dcinside.com")) ||
      links.find((a) => (a.getAttribute("href") || "").includes("dcinside.com"));
    if (!target) return false;
    target.scrollIntoView({ block: "center", inline: "center" });
    target.click();
    return true;
  });

  if (!clicked) throw new Error("dcinside link not found/clicked.");

  const navPromise = page
    .waitForNavigation({ waitUntil: "domcontentloaded", timeout: 25000 })
    .then(() => page)
    .catch(() => null);

  const p = await Promise.race([popupPromise, targetCreatedPromise, navPromise]);
  return p || page;
}

/** ------------------------------------------------------------
 * 1) enterSite(startUrl, targetUrl)
 * ----------------------------------------------------------- */
async function enterSite({
  startUrl,
  targetUrl,
  profileKey = "kr",
  headless = false,
  searchQuery = "디시인사이드",
} = {}) {
  if (!startUrl) throw new Error("enterSite: startUrl is required");
  if (!targetUrl) throw new Error("enterSite: targetUrl is required");

  const { browser, page } = await openPage({
    profileKey,
    url: startUrl,
    headless,
  });

  await naverSearchWithGivenInput(page, searchQuery);
  const targetPage = await clickFirstDcinsideResult(page, browser);

  if (!targetPage.url().startsWith(targetUrl)) {
    await targetPage.goto(targetUrl, { waitUntil: "domcontentloaded" });
  }

  return { browser, page: targetPage };
}

/** ------------------------------------------------------------
 * 2) login(dcinside)
 * ----------------------------------------------------------- */
async function login(page, { id, pw } = {}) {
  if (!page) throw new Error("login: page is required");
  if (!id) throw new Error("login: id is required");
  if (!pw) throw new Error("login: pw is required");

  await page.waitForSelector('a.mark[href*="msign.dcinside.com/login"], span.sign', {
    timeout: 20000,
  });

  const hasAnchor = await page.$('a.mark[href*="msign.dcinside.com/login"]');
  if (hasAnchor) {
    await Promise.allSettled([
      page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 25000 }),
      domClick(page, 'a.mark[href*="msign.dcinside.com/login"]'),
    ]);
  } else {
    await Promise.allSettled([
      page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 25000 }),
      domClick(page, "span.sign"),
    ]);
  }

  await setValue(page, 'input#code[name="code"]', id);
  await setValue(page, 'input#password[name="password"]', pw);

  await Promise.allSettled([
    page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 25000 }),
    page.keyboard.press("Enter"),
  ]);

  await sleep(300);

  /** (추가) 로그인 후 'cpibox btn_box'가 보이면 m.dcinside.com 링크 클릭 */
  const hasCpiboxBtnBox = await page.$("div.cpibox.btn_box");
  if (hasCpiboxBtnBox) {
    const targetHref = "https://m.dcinside.com";
    const clicked = await page.evaluate((href) => {
      const box = document.querySelector("div.cpibox.btn_box");
      if (!box) return false;
      const a = Array.from(box.querySelectorAll('a[href]')).find((x) => x.getAttribute("href") === href);
      if (!a) return false;
      a.scrollIntoView({ block: "center", inline: "center" });
      a.click();
      return true;
    }, targetHref);

    if (clicked) {
      await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 25000 }).catch(() => {});
    }
  }
}

/** ------------------------------------------------------------
 * 3) search(page, keyword)
 * ----------------------------------------------------------- */
/**
 * @param {import("puppeteer").Page} page
 * @param {string} keyword
 */
async function search(page, keyword) {
  if (!page) throw new Error("search: page is required");
  if (!keyword) throw new Error("search: keyword is required");

  /** 1) (검색창) search-all input에 바로 입력 */
  const searchAllInputSel = 'input.ipt-sch.search-all, input.search-all, form[role="search"] input[type="text"]';
  await page.waitForSelector(searchAllInputSel, { timeout: 20000 });
  await setValue(page, searchAllInputSel, keyword);

  /** 2) (제출) 버튼을 다시 눌러 제출 */
  const submitBtnSel = "button.sp-btn-sch, .search-box button.sp-btn-sch";
  await page.waitForSelector(submitBtnSel, { timeout: 20000 });

  const before = page.url();
  await Promise.allSettled([
    page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 25000 }),
    domClick(page, submitBtnSel),
  ]);

  /** 3) 이동이 없으면 form.submit fallback */
  if (page.url() === before) {
    await page.evaluate((inputSel) => {
      const input = document.querySelector(inputSel);
      const form = input?.closest("form");
      if (form && typeof form.submit === "function") form.submit();
    }, searchAllInputSel);
    await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 25000 }).catch(() => {});
  }

  await sleep(200);
}

/**
 * enterGallary(page, keyword)
 * - search(keyword) 실행
 * - ul.flex-gall-lst 의 첫 번째 li > a 클릭 (갤러리 진입)
 *
 * @param {import("puppeteer").Page} page
 * @param {string} keyword
 */
async function enterGallary(page, keyword) {
  if (!page) throw new Error("enterGallary: page is required");
  if (!keyword) throw new Error("enterGallary: keyword is required");

  /** 1) 검색 수행 */
  await search(page, keyword);

  /** 2) 결과 리스트(ul.flex-gall-lst) 첫 번째 항목 클릭 */
  const firstLinkSel = "ul.flex-gall-lst > li:first-child a[href]";
  await page.waitForSelector(firstLinkSel, { timeout: 25000 });

  /** 새 탭/현재 탭 모두 대응 */
  const popupPromise = new Promise((resolve) => page.once("popup", resolve)).catch(() => null);

  /** clickablePoint 회피: DOM click */
  const clicked = await page.evaluate((sel) => {
    const a = document.querySelector(sel);
    if (!a) return false;
    a.scrollIntoView({ block: "center", inline: "center" });
    a.click();
    return true;
  }, firstLinkSel);

  if (!clicked) throw new Error("enterGallary: failed to click first gallery link");

  /** 내비게이션 대기 (현재 탭 or 새 탭) */
  const navPromise = page
    .waitForNavigation({ waitUntil: "domcontentloaded", timeout: 25000 })
    .then(() => page)
    .catch(() => null);

  const p = await Promise.race([popupPromise, navPromise]);
  const targetPage = p || page;

  return targetPage;
}

/**
 * crawl(page, keyword, opts)
 * - 현재 페이지(게시글 리스트 화면)에서 keyword가 포함된 "게시글"을 최대 limit개 추출
 * - 결과를 JSON으로 저장(fs)
 *
 * @param {import("puppeteer").Page} page
 * @param {string} keyword
 * @param {object} [opts]
 * @param {number} [opts.limit=10]
 * @param {string} [opts.outDir="./out"]
 * @param {string} [opts.fileName] - 미지정 시 timestamp 기반 자동 생성
 * @returns {Promise<{filePath:string, items:Array}>}
 */
async function crawl(page, keyword, opts = {}) {
  if (!page) throw new Error("crawl: page is required");
  if (!keyword) throw new Error("crawl: keyword is required");

  const { limit = 10, outDir = "./out", fileName } = opts;

  /** 1) 페이지가 리스트를 렌더링할 시간(최소) */
  await page.waitForTimeout?.(300).catch(() => {});

  /** 2) 브라우저 DOM에서 후보 게시글 추출 */
  const items = await page.evaluate(
    ({ keyword, limit }) => {
      const kw = String(keyword).toLowerCase();
      const pickText = (el) => (el?.textContent || el?.innerText || "").trim();
      const normHref = (href) => {
        try { return new URL(href, location.href).href; } catch { return String(href || ""); }
      };

      /**
       * 우선순위 1) 질문에서 준 구조:
       *  <div class="gal-detail-lnkTb">
       *    <a href="...">
       *      <span class="subject">제목</span>
       *      <ul class="info">
       *        <li>tab</li>
       *        <li>user</li>
       *        <li>date/time</li>
       *        <li>views</li>
       *        <li>recommended</li>
       *      </ul>
       *    </a>
       *  </div>
       */
      const rows = Array.from(document.querySelectorAll("div.gall-detail-lnktb"));
      const out = [];

      for (const row of rows) {
        const a = row.querySelector('a[href*="/board/"], a[href]');
        if (!a) continue;

        const url = normHref(a.getAttribute("href") || a.href || "");
        if (!url) continue;
        if (!url.includes("/board/") && !url.includes("/mgallery/") && !url.includes("/mini/")) continue;

        /** 제목: subject "안의 내용만" */
        const titleEl =
          row.querySelector(".subjectin") ||      // ✅ 실제 제목
          row.querySelector(".subject");          // fallback
        const title = pickText(titleEl);
        // const subjectEl = row.querySelector(".subject");
        // const title = pickText(subjectEl);
        if (!title) continue;

        /** keyword 필터: 제목 기준 */
        if (!title.toLowerCase().includes(kw)) continue;

        /** ul.info 내 li 순서대로 매핑 */
        const infoLis = Array.from(row.querySelectorAll("ul.ginfo > li"));
        const info = infoLis.map((li) => pickText(li));

        const tab = info[0] || null;
        const user = info[1] || null;
        const dateTime = info[2] || null;
        const views = info[3] || null;
        const recommended = info[4] || null;

        out.push({
          title,
          url,
          tab,
          user,
          dateTime,
          views,
          recommended,
        });

        if (out.length >= limit) break;
      }
      return out;
    },
    { keyword, limit }
  );

  /** 3) 파일 저장(JSON) */
  const safeDir = path.resolve(process.cwd(), outDir);
  await fs.promises.mkdir(safeDir, { recursive: true });

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const outName = fileName || `crawl_${ts}.json`;
  const filePath = path.join(safeDir, outName);

  const payload = {
    keyword,
    limit,
    crawledAt: new Date().toISOString(),
    pageUrl: page.url(),
    count: items.length,
    items
  };

  await fs.promises.writeFile(filePath, JSON.stringify(payload, null, 2), "utf8");

  return { filePath, items };
}

/**
 * gotoUrl(page, url, opts)
 * - 현재 탭에서 지정 URL로 이동
 *
 * @param {import("puppeteer").Page} page
 * @param {string} url
 * @param {object} [opts]
 * @param {"domcontentloaded"|"load"|"networkidle0"|"networkidle2"} [opts.waitUntil="domcontentloaded"]
 * @param {number} [opts.timeout=30000]
 */
async function gotoUrl(page, url, opts = {}) {
  if (!page) throw new Error("gotoUrl: page is required");
  if (!url) throw new Error("gotoUrl: url is required");

  const { waitUntil = "domcontentloaded", timeout = 30000 } = opts;

  await page.goto(String(url), { waitUntil, timeout });
  return page;
}

/**
 * comment(page, text)
 * - textarea#comment-memo 에 입력
 * - button#btn-comment-write 클릭으로 등록
 *
 * @param {import("puppeteer").Page} page
 * @param {string} text
 */
async function comment(page, text) {
  console.log("comment start", text);

  if (!page) throw new Error("comment: page is required");
  if (!text) throw new Error("comment: text is required");

  const memoSel = "textarea#comment_memo";
  const submitSel = "button.btn-comment-write";

  /** 1) textarea 대기 + 입력 */
  await page.waitForSelector(memoSel, { timeout: 20000 });
  await page.focus(memoSel);

  /** 기존값 클리어 후 입력 */
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (el) el.value = "";
  }, memoSel);
  console.log("clear");

  await page.keyboard.type(String(text), { delay: 20 });

  console.log("typed");
  /** 2) 등록 버튼 클릭 + (가능하면) 네트워크 반영 대기 */
  await page.waitForSelector(submitSel, { timeout: 20000 });

  const beforeUrl = page.url();
  await Promise.allSettled([
    /** 댓글은 같은 페이지에서 XHR로 처리될 수 있어 navigation이 없을 수도 있음 */
    page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => null),
    page.evaluate((sel) => {
      const btn = document.querySelector(sel);
      if (!btn) return false;
      btn.scrollIntoView({ block: "center", inline: "center" });
      btn.click();
      return true;
    }, submitSel),
  ]);

  /** 3) 네비게이션이 없는 경우 대비: textarea가 비워졌는지/댓글 DOM 변화 잠깐 대기 */
  if (page.url() === beforeUrl) {
    await page.waitForFunction(
      (sel) => {
        const el = document.querySelector(sel);
        return !el || (el.value || "").trim().length === 0;
      },
      { timeout: 15000 },
      memoSel
    ).catch(() => {});
  }
}

module.exports = {
  enterSite,
  login,
  search,
  enterGallary,
  crawl,
  gotoUrl,
  comment,
};