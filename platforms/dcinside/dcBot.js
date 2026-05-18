/**
 * platforms/dcinside/dcBot.js
 *
 * =============================================================================
 * DCInside 고수준 기능 API
 * =============================================================================
 */

const { openPage } = require("../../core/browserEngine");
const { sleep } = require("../../core/helpers");
const {
  gotoUrlSafe,
  safeWaitNetworkIdle,
  safeEvaluate,
} = require("../../core/navigation");

const {
  loginDcinside,

  searchGallary,
  searchKeywordInGallery,
  clickFirstGalleryFromResult,

  extractGallaryPostItems,
  crawlGallary,
  writeComment,

  parseRange,
  toPostDate,
  formatKST_YYYY_MM_DD,

  toURL,
  toHref,
  setParam,
} = require("./dcInternals");

/**
 * userDataDirMode 값을 공통 모드로 정규화한다.
 */
function normalizeUserDataDirMode(mode) {
  if (mode === "temp") return "temp";
  if (mode === "promote") return "promote";
  return "persistent";
}

/**
 * 사이트 진입
 */
async function enterSite({
  targetUrl = "https://m.dcinside.com",
  storageKey = "dc_main",
  localeProfileKey = "kr",
  headless = false,
  viewport = { width: 1000, height: 1200 },
  useMobile = true,
  userDataDirMode = "persistent",
} = {}) {
  return openPage({
    url: targetUrl,
    storageKey,
    localeProfileKey,
    headless,
    viewport,
    userDataDirMode: normalizeUserDataDirMode(userDataDirMode),
    useMobile,
    tag: "dc.page",
    launchArgs: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
    ],
  });
}

/**
 * 자동 로그인
 */
async function login(page, { id, pw } = {}) {
  return loginDcinside(page, { id, pw });
}

/**
 * 로그인 상태를 추정한다.
 */
async function isDcinsideLoggedIn(page) {
  if (!page) throw new Error("isDcinsideLoggedIn: page is required");

  const result = await safeEvaluate(
    page,
    () => {
      const href = String(location.href || "");
      const bodyText = String(document.body?.innerText || "");

      if (href.includes("msign.dcinside.com/login")) {
        return {
          ok: false,
          reason: "LOGIN_URL",
          href,
        };
      }

      const loginCandidates = Array.from(
        document.querySelectorAll(
          'a.mark[href*="msign.dcinside.com/login"], a[href*="/login"], span.sign',
        ),
      );

      const hasVisibleLoginUi = loginCandidates.some((el) => {
        const text = String(el.textContent || "").trim();
        const hrefValue = String(el.getAttribute?.("href") || "");
        return text.includes("로그인") || hrefValue.includes("login");
      });

      const hasLogoutText = bodyText.includes("로그아웃");

      return {
        ok: Boolean(hasLogoutText || !hasVisibleLoginUi),
        reason: hasLogoutText ? "LOGOUT_TEXT" : hasVisibleLoginUi ? "LOGIN_UI" : "NO_LOGIN_UI",
        href,
        hasVisibleLoginUi,
        hasLogoutText,
      };
    },
    {
      tag: "dc.isLoggedIn",
    },
  );

  return Boolean(result?.ok);
}

/**
 * 사용자가 수동 로그인을 완료할 때까지 기다린다.
 */
async function waitForDcinsideLogin(page, opts = {}) {
  if (!page) throw new Error("waitForDcinsideLogin: page is required");

  const {
    timeout = 10 * 60 * 1000,
    checkInterval = 1000,
    loginUrl = "https://msign.dcinside.com/login",
    afterLoginUrl = "https://m.dcinside.com",
  } = opts;

  if (await isDcinsideLoggedIn(page)) {
    return page;
  }

  page = await gotoUrlSafe(page, loginUrl, {
    waitUntil: "domcontentloaded",
    timeout: 30000,
    tag: "dc.waitLogin.goto",
  });

  await safeWaitNetworkIdle(page, 10000);

  const start = Date.now();

  while (Date.now() - start < timeout) {
    const loggedIn = await isDcinsideLoggedIn(page);

    if (loggedIn) {
      page = await gotoUrlSafe(page, afterLoginUrl, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
        tag: "dc.waitLogin.afterLogin",
      });

      await safeWaitNetworkIdle(page, 10000);
      await sleep(500);

      return page;
    }

    await sleep(checkInterval);
  }

  throw new Error("waitForDcinsideLogin: timeout");
}

/**
 * 로그인 보장
 */
async function ensureDcinsideLoggedIn(page, opts = {}) {
  if (!page) throw new Error("ensureDcinsideLoggedIn: page is required");

  const loggedIn = await isDcinsideLoggedIn(page);
  if (loggedIn) return page;

  return waitForDcinsideLogin(page, opts);
}

/**
 * 검색
 */
async function search(page, keyword) {
  return searchGallary(page, keyword);
}

/**
 * 갤러리 진입
 */
async function enterGallary(page, keyword) {
  if (!page) throw new Error("enterGallary: page is required");
  if (!keyword) throw new Error("enterGallary: keyword is required");

  await searchGallary(page, keyword);
  return clickFirstGalleryFromResult(page);
}

/**
 * 갤러리 진입 별칭
 */
async function enterGallery(page, keyword) {
  return enterGallary(page, keyword);
}

/**
 * 크롤링
 */
async function crawl(page, opts = {}) {
  return crawlGallary(page, opts);
}

/**
 * 안전 이동
 */
async function gotoUrl(page, url, opts = {}) {
  return gotoUrlSafe(page, url, opts);
}

/**
 * 현재 게시글에 댓글 작성
 */
async function comment(page, text) {
  return writeComment(page, text);
}

/**
 * URL page 파라미터로 목록 페이지를 이동한다.
 */
async function moveListPage(page, pageNum) {
  const u = toURL(page.url());
  setParam(u, "page", pageNum);

  const nextUrl = toHref(u);

  return gotoUrlSafe(page, nextUrl, {
    waitUntil: "domcontentloaded",
    timeout: 30000,
    tag: "dc.moveListPage",
  });
}

/**
 * 게시글 URL로 이동한 뒤 댓글을 작성한다.
 */
async function createComment(page, { url, commentText } = {}) {
  if (!page) throw new Error("createComment: page is required");
  if (!url) throw new Error("createComment: url is required");
  if (!commentText) throw new Error("createComment: commentText is required");

  page = await gotoUrlSafe(page, url, {
    waitUntil: "domcontentloaded",
    timeout: 30000,
    tag: "dc.comment.gotoPost",
  });

  await safeWaitNetworkIdle(page, 10000);
  await sleep(500);

  await writeComment(page, commentText);

  await safeWaitNetworkIdle(page, 10000);
  await sleep(700);

  return page;
}

/**
 * 갤러리/키워드/날짜 범위 기준으로 게시글을 찾아 댓글을 작성한다.
 */
async function commentOnSearchResults(
  page,
  {
    gallery,
    keyword,
    dateRange,
    count = 1,
    commentText,
    createCommentText,
    maxPages = 50,
  } = {},
) {
  if (!page) throw new Error("commentOnSearchResults: page is required");
  if (!gallery) throw new Error("commentOnSearchResults: gallery is required");
  if (!keyword) throw new Error("commentOnSearchResults: keyword is required");
  if (!commentText && typeof createCommentText !== "function") {
    throw new Error("commentOnSearchResults: commentText or createCommentText is required");
  }

  if (!count || count <= 0) {
    return {
      page,
      urls: [],
      posts: [],
      failures: [],
    };
  }

  page = await ensureDcinsideLoggedIn(page);

  /**
   * 1) 디시 사이트 → 갤러리 진입
   */
  page = await enterGallary(page, gallery);
  await safeWaitNetworkIdle(page, 1000);
  await sleep(500);

  /**
   * 2) 갤러리/검색 화면에서 키워드 검색
   */
  page = await searchKeywordInGallery(page, keyword);
  await safeWaitNetworkIdle(page, 1000);
  await sleep(500);

  const range = dateRange ? parseRange(dateRange) : null;
  const now = new Date();

  const posted = [];
  const failures = [];
  const seenUrls = new Set();

  let pageNum = Number(toURL(page.url()).searchParams.get("page") || "1") || 1;

  while (posted.length < count && pageNum <= maxPages) {
    console.log(`[dc][comment] scan page=${pageNum} posted=${posted.length}/${count}`);

    const listUrl = page.url();

    const items = await extractGallaryPostItems(page, {
      keyword,
      limit: Math.max(50, count * 3),
    });

    const itemList = Array.isArray(items) ? items : [];

    if (itemList.length === 0) {
      console.log("[dc][comment] no items on page, stop");
      break;
    }

    for (const post of itemList) {
      if (posted.length >= count) break;
      if (!post?.url || seenUrls.has(post.url)) continue;

      seenUrls.add(post.url);

      const postDate = toPostDate(post.dateTime, now);

      if (range) {
        if (!postDate) {
          console.log("[dc][comment] skip: date parse failed", {
            title: post.title,
            dateTime: post.dateTime,
          });
          continue;
        }

        const inRange =
          postDate.getTime() >= range.start.getTime() &&
          postDate.getTime() <= range.end.getTime();

        if (!inRange) {
          console.log("[dc][comment] skip: out of range", {
            title: post.title,
            dateTime: post.dateTime,
            parsed: formatKST_YYYY_MM_DD(postDate),
          });
          continue;
        }
      }

      const nextCommentText = typeof createCommentText === "function"
        ? await createCommentText({
          gallery,
          keyword,
          dateRange,
          post,
        })
        : commentText;

      if (!nextCommentText) {
        console.log("[dc][comment] skip: empty comment", {
          title: post.title,
          url: post.url,
        });
        continue;
      }

      try {
        console.log("[dc][comment] selected post:", {
          title: post.title,
          url: post.url,
          dateTime: post.dateTime,
        });

        page = await createComment(page, {
          url: post.url,
          commentText: nextCommentText,
        });

        posted.push({
          title: post.title,
          url: post.url,
          dateTime: post.dateTime,
          commentText: nextCommentText,
        });

        console.log("[dc][comment] posted:", {
          title: post.title,
          url: post.url,
        });
      } catch (err) {
        const message = String(err?.message || err || "unknown error");

        failures.push({
          title: post.title,
          url: post.url,
          error: message,
        });

        console.error("[dc][comment] failed on post:", {
          title: post.title,
          url: post.url,
          error: message,
        });
      }

      if (posted.length < count) {
        page = await gotoUrlSafe(page, listUrl, {
          waitUntil: "domcontentloaded",
          timeout: 30000,
          tag: "dc.comment.backToList",
        });

        await safeWaitNetworkIdle(page, 10000);
        await sleep(500);
      }

      await sleep(1000);
    }

    if (posted.length >= count) break;

    pageNum += 1;
    page = await moveListPage(page, pageNum);
    await safeWaitNetworkIdle(page, 10000);
    await sleep(500);
  }

  return {
    page,
    urls: posted.map((p) => p.url),
    posts: posted,
    failures,
  };
}

module.exports = {
  enterSite,
  login,

  isDcinsideLoggedIn,
  waitForDcinsideLogin,
  ensureDcinsideLoggedIn,

  search,
  enterGallary,
  enterGallery,

  crawl,
  gotoUrl,
  comment,

  createComment,
  commentOnSearchResults,
};