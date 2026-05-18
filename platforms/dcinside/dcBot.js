// /**
//  * platforms/dcinside/dcBot.js
//  *
//  * =============================================================================
//  * DCInside 고수준 기능 API
//  * =============================================================================
//  *
//  * 제공 기능:
//  *
//  * 1) enterSite()
//  *    - 시작 페이지(보통 네이버 모바일) 열기
//  *    - 네이버 검색으로 디시인사이드 찾기
//  *    - 결과 클릭
//  *    - 최종 targetUrl 보정
//  *
//  * 2) login(page, { id, pw })
//  *    - 로그인 버튼 진입
//  *    - 아이디/비밀번호 입력
//  *    - 엔터 로그인
//  *    - 로그인 후 m.dcinside.com 복귀 박스 대응
//  *
//  * 3) search(page, keyword)
//  *    - 상단 검색창으로 검색
//  *
//  * 4) enterGallary(page, keyword)
//  *    - 검색 수행
//  *    - 첫 갤러리 클릭
//  *
//  * 5) crawl(page, opts)
//  *    - 탭/추천/날짜/키워드/수량 기준 크롤링
//  *    - JSON 저장 후 파일 경로 반환
//  *
//  * 6) gotoUrl(page, url)
//  *    - 안전 이동
//  *
//  * 7) comment(page, text)
//  *    - 댓글 textarea 입력
//  *    - 등록 버튼 클릭
//  *
//  * 주의:
//  *  - 기존 함수명 호환을 위해 enterGallary 오탈자 이름도 유지한다.
//  *  - 실제 저수준 DOM 처리는 dcInternals.js에 둔다.
//  * =============================================================================
//  */

// const { openPage } = require("../../core/browserEngine");
// const { gotoUrlSafe } = require("../../core/navigation");

// const {
//   naverSearchWithGivenInput,
//   clickFirstDcinsideResult,
//   loginDcinside,

//   searchGallary,
//   clickFirstGalleryFromResult,

//   crawlGallary,
//   writeComment,
// } = require("./dcInternals");

// /** ****************************************************************************
//  * 1) 사이트 진입
//  *
//  * 단계:
//  *  - startUrl로 진입
//  *  - 네이버 검색창에 searchQuery 입력
//  *  - 검색 결과 중 dcinside 첫 링크 클릭
//  *  - targetUrl과 다르면 최종 보정 이동
//  ******************************************************************************/
// async function enterSite({
//   startUrl = "https://m.naver.com",
//   targetUrl = "https://m.dcinside.com",
//   storageKey = "dc_main",
//   localeProfileKey = "kr",
//   headless = false,
//   searchQuery = "디시인사이드",
//   viewport = { width: 430, height: 932 },
//   useMobile = true,
// } = {}) {
//   const { browser, page } = await openPage({
//     url: startUrl,
//     storageKey,
//     localeProfileKey,
//     headless,
//     viewport,
//     userDataDirMode: "persistent",
//     useMobile,
//     tag: "dc.page",
//     args: [
//       "--no-sandbox",
//       "--disable-setuid-sandbox"
//     ]
//   });

//   await naverSearchWithGivenInput(page, searchQuery);
//   const targetPage = await clickFirstDcinsideResult(page, browser);

//   if (!targetPage.url().startsWith(targetUrl)) {
//     await targetPage.goto(targetUrl, { waitUntil: "domcontentloaded" });
//   }

//   return { browser, page: targetPage };
// }

// /** ****************************************************************************
//  * 2) 로그인
//  ******************************************************************************/
// async function login(page, { id, pw } = {}) {
//   return loginDcinside(page, { id, pw });
// }

// /** ****************************************************************************
//  * 3) 검색
//  ******************************************************************************/
// async function search(page, keyword) {
//   return searchGallary(page, keyword);
// }

// /** ****************************************************************************
//  * 4) 갤러리 진입
//  *
//  * 단계:
//  *  - search(keyword)
//  *  - 결과 첫 갤러리 클릭
//  *
//  * 호환:
//  *  - 기존 코드의 오탈자 함수명 enterGallary 유지
//  *  - 새 코드에서는 enterGallery 별칭도 같이 제공
//  ******************************************************************************/
// async function enterGallary(page, keyword) {
//   if (!page) throw new Error("enterGallary: page is required");
//   if (!keyword) throw new Error("enterGallary: keyword is required");

//   await searchGallary(page, keyword);
//   return clickFirstGalleryFromResult(page);
// }

// /** 별칭 */
// async function enterGallery(page, keyword) {
//   return enterGallary(page, keyword);
// }

// /** ****************************************************************************
//  * 5) 크롤링
//  ******************************************************************************/
// async function crawl(page, opts = {}) {
//   return crawlGallary(page, opts);
// }

// /** ****************************************************************************
//  * 6) 안전 이동
//  ******************************************************************************/
// async function gotoUrl(page, url, opts = {}) {
//   return gotoUrlSafe(page, url, opts);
// }

// /** ****************************************************************************
//  * 7) 댓글 작성
//  ******************************************************************************/
// async function comment(page, text) {
//   return writeComment(page, text);
// }

// module.exports = {
//   enterSite,
//   login,
//   search,
//   enterGallary,
//   enterGallery,
//   crawl,
//   gotoUrl,
//   comment,
// };

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
  targetUrl = "https://www.dcinside.com",
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
    loginUrl = "https://sign.dcinside.com/login",
    afterLoginUrl = "https://www.dcinside.com",
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