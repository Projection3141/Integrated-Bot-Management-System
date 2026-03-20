/**
 * platforms/reddit/runReddit.js
 *
 * =============================================================================
 * REDDIT RUNNER
 * =============================================================================
 *
 * 역할:
 *  - Reddit 자동화 시나리오를 실제로 실행하는 runner
 *  - 직접 `node runReddit.js`로 실행 가능
 *  - Electron main.js에서도 child process로 실행 가능
 *
 * 구조:
 *  - runReddit()를 export
 *  - require.main === module 인 경우에만 직접 실행
 * =============================================================================
 */

/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const {
  enterSite,
  loginRedditAuto,
  searchAndScroll,
  enterSubreddit,
  createTextPost,
  createComment,
  commentOnSearchResults,
} = require("./redditBot");
const { closeAll } = require("../../core/browserEngine");
const { sleep } = require("../../core/helpers");

const HISTORY_DIR = path.resolve(process.cwd(), "history");
const HISTORY_FILE = path.join(HISTORY_DIR, "history.log");

function ensureHistoryDir() {
  try {
    fs.mkdirSync(HISTORY_DIR, { recursive: true });
  } catch {
    /** ignore */
  }
}

function appendHistory(entry) {
  try {
    ensureHistoryDir();
    const line = JSON.stringify({
      createdAt: new Date().toISOString(),
      ...entry,
    });
    fs.appendFileSync(HISTORY_FILE, line + "\n", "utf8");
  } catch {
    /** ignore */
  }
}

const REDDIT_USERNAME = process.env.REDDIT_USERNAME || "";
const REDDIT_PASSWORD = process.env.REDDIT_PASSWORD || "";

const REDDIT_TARGET_SUBREDDIT = process.env.REDDIT_TARGET_SUBREDDIT || "";
const REDDIT_TARGET_KEYWORD = process.env.REDDIT_TARGET_KEYWORD || "";
const REDDIT_TARGET_DATE_RANGE = process.env.REDDIT_TARGET_DATE_RANGE || "";
const REDDIT_TARGET_COMMENT_COUNT = Number(process.env.REDDIT_TARGET_COMMENT_COUNT || "0");
const REDDIT_TARGET_COMMENT_TEXT = process.env.REDDIT_TARGET_COMMENT_TEXT || "";

const HEADLESS =
  process.env.BOT_HEADLESS === "1";

async function runReddit() {
  console.log("[runReddit] runner started");
  
  const { page } = await enterSite({
    headless: HEADLESS,
    storageKey: "reddit_main",
    localeProfileKey: "kr",
    useTempProfile: true,
  });
  
  console.log("[runReddit] entered site");

  try {
    /** --------------------------------------------------------
     * 1) 로그인
     * - 환경변수가 있으면 자동 로그인
     * - 없으면 스킵
     * ------------------------------------------------------- */
    if (REDDIT_USERNAME && REDDIT_PASSWORD) {
      await loginRedditAuto(page, {
        username: REDDIT_USERNAME,
        password: REDDIT_PASSWORD,
      });
    } else {
      console.log("[runReddit] login skipped: set REDDIT_USERNAME / REDDIT_PASSWORD env if needed");
    }

    /** --------------------------------------------------------
     * 2) 댓글 자동 게시 (환경변수 기반)
     * ------------------------------------------------------- */
    if (
      REDDIT_TARGET_SUBREDDIT &&
      REDDIT_TARGET_KEYWORD &&
      REDDIT_TARGET_COMMENT_TEXT &&
      REDDIT_TARGET_COMMENT_COUNT > 0
    ) {
      console.log("[runReddit] comment job starting", {
        subreddit: REDDIT_TARGET_SUBREDDIT,
        keyword: REDDIT_TARGET_KEYWORD,
        dateRange: REDDIT_TARGET_DATE_RANGE,
        count: REDDIT_TARGET_COMMENT_COUNT,
      });

      const result = await commentOnSearchResults(page, {
        subreddit: REDDIT_TARGET_SUBREDDIT,
        keyword: REDDIT_TARGET_KEYWORD,
        dateRange: REDDIT_TARGET_DATE_RANGE,
        count: REDDIT_TARGET_COMMENT_COUNT,
        commentText: REDDIT_TARGET_COMMENT_TEXT,
      });

      appendHistory({
        target: "reddit",
        config: {
          subreddit: REDDIT_TARGET_SUBREDDIT,
          keyword: REDDIT_TARGET_KEYWORD,
          dateRange: REDDIT_TARGET_DATE_RANGE,
          count: REDDIT_TARGET_COMMENT_COUNT,
          commentText: REDDIT_TARGET_COMMENT_TEXT,
        },
        urls: Array.isArray(result?.urls) ? result.urls : [],
      });

      await sleep(2000);
    } else {
      /** --------------------------------------------------------
       * 3) 브라우저 유지 시간
       * ------------------------------------------------------- */
      await sleep(10000);
    }
  } catch (e) {
    console.error("[runReddit] ❌ failed:", e?.message || e);
    throw e;
  } finally {
    await closeAll();
  }
}

if (require.main === module) {
  runReddit().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
}

module.exports = runReddit;