// /* ============================================================
// FILE: dcinside/func.js
// ============================================================ */

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
 * URL helpers
 * ----------------------------------------------------------- */
/**
 * @param {string} href
 * @returns {URL}
 */
function toURL(href) {
  return new URL(href);
}

/**
 * @param {URL} u
 * @returns {string}
 */
function toHref(u) {
  return u.toString();
}

/**
 * query param set/remove
 * - value가 null/undefined면 삭제
 */
function setParam(u, key, value) {
  if (value === null || value === undefined || value === "") u.searchParams.delete(key);
  else u.searchParams.set(key, String(value));
  return u;
}

/** ------------------------------------------------------------
 * Date helpers (YY.MM.DD / time-only "HH:MM")
 * ----------------------------------------------------------- */
/**
 * "25. 07.20~26. 02.06" 같은 문자열을 [startDate,endDate] 로 파싱
 * - inclusive range
 * - YY는 2000+YY로 해석
 */
function parseRange(rangeStr) {
  if (!rangeStr) return null;

  const cleaned = String(rangeStr)
    .replace(/\s+/g, "")
    .replace(/[^\d.~]/g, ""); // 콤마 등 제거

  const parts = cleaned.split("~");
  if (parts.length !== 2) throw new Error(`date range format invalid: ${rangeStr}`);

  const start = parseYYMMDD(parts[0]);
  const end = parseYYMMDD(parts[1]);
  if (!start || !end) throw new Error(`date range parse failed: ${rangeStr}`);

  if (start.getTime() > end.getTime()) return { start: end, end: start };
  return { start, end };
}

/** "KST 자정" Date 생성 */
function kstMidnight(yyyy, mm, dd) {
  const utcMs = Date.UTC(yyyy, mm - 1, dd, 0, 0, 0, 0) - 9 * 60 * 60 * 1000;
  return new Date(utcMs);
}

function formatKST_YYYY_MM_DD(d) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const get = (t) => parts.find((p) => p.type === t)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** KST y/m/d 추출 */
function getKSTYMD(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);

  const y = Number(parts.find((p) => p.type === "year")?.value);
  const m = Number(parts.find((p) => p.type === "month")?.value);
  const d = Number(parts.find((p) => p.type === "day")?.value);
  return { y, m, d };
}

function parseYYMMDD(s) {
  const m = String(s).match(/^(\d{2})\.(\d{2})\.(\d{2})$/);
  if (!m) return null;
  const yyyy = 2000 + Number(m[1]);
  const mm = Number(m[2]);
  const dd = Number(m[3]);
  return kstMidnight(yyyy, mm, dd);
}

/**
 * 디시 dateTime 문자열을 KST 기준 Date(자정)으로 변환
 * 지원:
 *  - "HH:MM"                 => KST 오늘
 *  - "YY.MM.DD"              => 해당 날짜
 *  - "YY. MM.DD"             => 공백 제거 후 처리
 *  - "YYYY.MM.DD"            => 해당 날짜
 *  - "MM.DD" (연도 없음)     => KST 현재 연도 가정
 *  - 끝에 "." / 기타 문자    => 정리 후 처리
 */
function toPostDate(dateTimeRaw, now = new Date()) {
  const raw = String(dateTimeRaw || "").trim();
  if (!raw) return null;

  const s = raw.replace(/\s+/g, "").replace(/[^\d.:]/g, ""); // 숫자, 점, 콜론만 남김
  if (!s) return null;

  // time-only "HH:MM"
  if (/^\d{2}:\d{2}$/.test(s)) {
    const { y, m, d } = getKSTYMD(now);
    return kstMidnight(y, m, d);
  }

  // YYYY.MM.DD
  let m4 = s.match(/^(\d{4})\.(\d{2})\.(\d{2})$/);
  if (m4) {
    const yyyy = Number(m4[1]);
    const mm = Number(m4[2]);
    const dd = Number(m4[3]);
    return kstMidnight(yyyy, mm, dd);
  }

  // YY.MM.DD
  let m2 = s.match(/^(\d{2})\.(\d{2})\.(\d{2})$/);
  if (m2) {
    const yyyy = 2000 + Number(m2[1]);
    const mm = Number(m2[2]);
    const dd = Number(m2[3]);
    return kstMidnight(yyyy, mm, dd);
  }

  // MM.DD (연도 없음)
  let md = s.match(/^(\d{2})\.(\d{2})$/);
  if (md) {
    const { y } = getKSTYMD(now);
    const mm = Number(md[1]);
    const dd = Number(md[2]);
    return kstMidnight(y, mm, dd);
  }

  return null;
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

  await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 25000 }).catch(() => { });
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
      } catch (_) { }
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
      await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 25000 }).catch(() => { });
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
    await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 25000 }).catch(() => { });
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

/** ------------------------------------------------------------
 * crwal() 관련 URL 조작 함수
 * ----------------------------------------------------------- */
/**
 * selectRecommend()
 * - 현재 URL에 recommend=1 세팅
 */
async function selectRecommend(page) {
  if (!page) throw new Error("selectRecommend: page is required");

  const u = toURL(page.url());
  setParam(u, "recommend", 1);

  /** 기존과 동일 URL이면 skip */
  const next = toHref(u);
  if (next === page.url()) return page;

  await gotoUrl(page, next, { waitUntil: "domcontentloaded" });

  return page;
}

/**
 * selectTab(tabStr)
 * - tabStr 매핑: '전체' => null(파라미터 제거), '일반' => 0
 * - 이미 ?headid=가 있으면 값만 변경
 * - recommend=1 있으면 &로 붙이는 건 URLSearchParams가 자동 처리
 */
async function selectTab(page, tabStr) {
  if (!page) throw new Error("selectTab: page is required");

  const map = {
    전체: null,
    일반: 0,
  };

  const tabNum = Object.prototype.hasOwnProperty.call(map, tabStr) ? map[tabStr] : tabStr;

  const u = toURL(page.url());
  setParam(u, "headid", tabNum);

  const next = toHref(u);
  if (next === page.url()) return page;

  await gotoUrl(page, next, { waitUntil: "domcontentloaded" });
  return page;
}

/**
 * movePage(pageNum)
 * - 현재 URL에서 page 파라미터만 조절
 * - recommend/headid 존재 시에도 자연스럽게 &로 연결 (URLSearchParams)
 */
async function movePage(page, pageNum) {
  if (!page) throw new Error("movePage: page is required");
  if (!Number.isFinite(pageNum)) throw new Error("movePage: pageNum must be a number");

  const u = toURL(page.url());
  setParam(u, "page", pageNum);

  const next = toHref(u);
  if (next === page.url()) return page;

  await gotoUrl(page, next, { waitUntil: "domcontentloaded" });

  console.log(`[movePage] moved to page=${pageNum} url=${next}`);
  return page;
}

/* ============================================================
 crawl() 
============================================================ */
async function crawl(page, opts = {}) {
  if (!page) throw new Error("crawl: page is required");

  const {
    tab,
    date,
    recommend = false,
    keyword,
    amount,
    outDir = "./out",
    fileName,

    /** 무한 탐색 방지 옵션 */
    maxPages = 300,
    maxConsecutiveNoDatePages = 8,
  } = opts;

  if (!keyword) throw new Error("crawl: opts.keyword is required");
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("crawl: opts.amount must be a positive number");
  }

  if (recommend === true) await selectRecommend(page);
  if (typeof tab === "string" && tab.length > 0) await selectTab(page, tab);

  const range = date ? parseRange(date) : null;
  const now = new Date();

  const curUrl = toURL(page.url());
  const startPageNum = Number(curUrl.searchParams.get("page") || "1") || 1;

  const collected = [];
  let pageNum = startPageNum;
  let pagesVisited = 0;
  let stopReason = null;
  let consecutiveNoDatePages = 0;

  while (collected.length < amount) {
    if (pagesVisited >= maxPages) {
      stopReason = "max_pages_reached";
      console.log(`[crawl] STOP ${stopReason} maxPages=${maxPages}`);
      break;
    }

    pagesVisited += 1;
    console.log(`[crawl] LOOP page=${pageNum} url=${page.url()} collected=${collected.length}/${amount}`);

    await page.waitForSelector("body", { timeout: 20000 });
    await page.waitForTimeout?.(300).catch(() => {});

    /** ✅ 1-pass extract only (gall-detail-lnktb) */
    const items = await page.evaluate(
      ({ keyword, limit }) => {
        const kw = String(keyword).toLowerCase();
        const pickText = (el) => (el?.textContent || el?.innerText || "").trim();
        const normHref = (href) => {
          try { return new URL(href, location.href).href; } catch { return String(href || ""); }
        };

        const rows = Array.from(document.querySelectorAll("div.gall-detail-lnktb"));
        const out = [];

        for (const row of rows) {
          const a = row.querySelector('a[href*="/board/"], a[href*="/mgallery/"], a[href*="/mini/"], a[href]');
          if (!a) continue;

          const url = normHref(a.getAttribute("href") || a.href || "");
          if (!url) continue;
          if (!url.includes("/board/") && !url.includes("/mgallery/") && !url.includes("/mini/")) continue;

          const titleEl = row.querySelector(".subjectin") || row.querySelector(".subject");
          const title = pickText(titleEl);
          if (!title) continue;
          if (!title.toLowerCase().includes(kw)) continue;

          const infoLis = Array.from(row.querySelectorAll("ul.ginfo > li"));
          const info = infoLis.map((li) => pickText(li));

          out.push({
            title,
            url,
            tab: info[0] || null,
            user: info[1] || null,
            dateTime: info[2] || null,
            views: info[3] || null,
            upAdd: info[4] || null,
            source: "gall-detail-lnktb",
          });

          if (out.length >= limit) break;
        }

        return out;
      },
      { keyword, limit: Math.max(50, amount) }
    );

    console.log(`[crawl] extracted=${items?.length} raw`);

    let newestOnPage = null;
    let oldestOnPage = null;
    let parsedDateCount = 0;
    let addedThisPage = 0;

    const itemsArr = Array.isArray(items) ? items : [];

    /** ✅ 크롤 -> date 판단(아이템별) */
    for (let i = 0; i < itemsArr.length; i += 1) {
      const it = itemsArr[i];
      const postDate = toPostDate(it?.dateTime, now);

      if (postDate) {
        parsedDateCount += 1;
        if (!newestOnPage || postDate.getTime() > newestOnPage.getTime()) newestOnPage = postDate;
        if (!oldestOnPage || postDate.getTime() < oldestOnPage.getTime()) oldestOnPage = postDate;
      }

      if (!range) {
        collected.push(it);
        addedThisPage += 1;
      } else {
        if (!postDate) continue;

        const inRange =
          postDate.getTime() >= range.start.getTime() &&
          postDate.getTime() <= range.end.getTime();

        if (inRange) {
          collected.push(it);
          addedThisPage += 1;
          console.log(
            `[crawl] +1 title="${(it?.title || "").slice(0, 40)}" dateTime="${it?.dateTime}" -> date(KST)=${formatKST_YYYY_MM_DD(postDate)}`
          );
        }
      }

      if (collected.length >= amount) break;
    }

    const newestStr = newestOnPage ? formatKST_YYYY_MM_DD(newestOnPage) : "n/a";
    const oldestStr = oldestOnPage ? formatKST_YYYY_MM_DD(oldestOnPage) : "n/a";
    const rangeStr = range
      ? `${formatKST_YYYY_MM_DD(range.start)}~${formatKST_YYYY_MM_DD(range.end)}`
      : "none";

    console.log(
      `[crawl] PAGE_DONE page=${pageNum} added=${addedThisPage} parsedDates=${parsedDateCount} newest=${newestStr} oldest=${oldestStr} range=${rangeStr} total=${collected.length}/${amount}`
    );

    /** ✅ 무한 탐색 방지: 날짜 파싱이 계속 0이면 종료 */
    if (range) {
      if (parsedDateCount === 0) consecutiveNoDatePages += 1;
      else consecutiveNoDatePages = 0;

      if (consecutiveNoDatePages >= maxConsecutiveNoDatePages) {
        stopReason = "date_parse_failed";
        console.log(
          `[crawl] STOP ${stopReason} consecutiveNoDatePages=${consecutiveNoDatePages}`
        );
        break;
      }

      /** ✅ 종료 조건: "이 페이지 최신글"조차 start보다 과거면 종료 */
      if (newestOnPage && newestOnPage.getTime() < range.start.getTime()) {
        stopReason = "date_out_of_range";
        console.log(
          `[crawl] STOP ${stopReason} newest=${newestStr} < start=${formatKST_YYYY_MM_DD(range.start)}`
        );
        break;
      }
    }

    if (collected.length >= amount) {
      stopReason = "amount_reached";
      console.log(`[crawl] STOP ${stopReason}`);
      break;
    }

    /** ✅ 페이지 이동(페이지당 1회) */
    pageNum += 1;
    console.log(`[crawl] MOVE nextPage=${pageNum}`);
    await movePage(page, pageNum);
  }

  const finalItems = collected.slice(0, amount);
  console.log(`[crawl] FINISH total=${finalItems.length} pagesVisited=${pagesVisited} stopReason=${stopReason}`);

  const safeDir = path.resolve(process.cwd(), outDir);
  await fs.promises.mkdir(safeDir, { recursive: true });

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const outName = fileName || `crawl_${ts}.json`;
  const filePath = path.join(safeDir, outName);

  const payload = {
    filters: { tab: tab ?? null, date: date ?? null, recommend: !!recommend, keyword, amount },
    crawledAt: new Date().toISOString(),
    startUrl: page.url(),
    pagesVisited,
    stopReason,
    count: finalItems.length,
    items: finalItems,
  };

  await fs.promises.writeFile(filePath, JSON.stringify(payload, null, 2), "utf8");
  return { filePath, items: finalItems, meta: payload };
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
    ).catch(() => { });
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