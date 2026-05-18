/**
 * platforms/dcinside/runDcinside.js
 *
 * =============================================================================
 * DCINSIDE RUNNER
 * =============================================================================
 */

/* eslint-disable no-console */
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  enterSite,
  ensureDcinsideLoggedIn,
  commentOnSearchResults,
  // crawl,
} = require("./dcBot");

const {
  closeAll,
  armProfilePromotion,
  finalizeProfilePromotion,
} = require("../../core/browserEngine");

const { sleep } = require("../../core/helpers");
const { createDcinsideCommentRecommendingLink } = require("../../llm/runLlm");

/**
 * env string 읽기
 */
function readEnvString(name, fallback = "") {
  const value = process.env[name];
  return typeof value === "string" ? value : fallback;
}

/**
 * env number 읽기
 */
function readEnvNumber(name, fallback = 0) {
  const raw = process.env[name];
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * env boolean 읽기
 */
function readEnvBool(name, fallback = false) {
  const raw = readEnvString(name, "");
  if (raw === "1" || raw.toLowerCase() === "true") return true;
  if (raw === "0" || raw.toLowerCase() === "false") return false;
  return fallback;
}

/**
 * userDataDirMode 정규화
 */
function normalizeUserDataDirMode(mode) {
  if (mode === "temp") return "temp";
  if (mode === "promote") return "promote";
  return "persistent";
}

/**
 * writable user data root
 */
function getWritableUserDataRoot() {
  const fromEnv = readEnvString("BOT_USER_DATA", "").trim();
  if (fromEnv) return fromEnv;

  return path.join(os.homedir(), ".automation-bot");
}

/**
 * history 경로
 */
const USER_DATA_ROOT = getWritableUserDataRoot();
const HISTORY_DIR = path.join(USER_DATA_ROOT, "history");
const HISTORY_FILE = path.join(HISTORY_DIR, "history.log");

/**
 * history 디렉터리 생성
 */
function ensureHistoryDir() {
  try {
    fs.mkdirSync(HISTORY_DIR, { recursive: true });
  } catch {
    /** ignore */
  }
}

/**
 * history append
 */
function appendHistory(entry) {
  try {
    ensureHistoryDir();

    const line = JSON.stringify({
      createdAt: new Date().toISOString(),
      target: "dc",
      ...entry,
    });

    fs.appendFileSync(HISTORY_FILE, line + "\n", "utf8");
  } catch (err) {
    console.error("[runDcinside] appendHistory failed:", err?.message || err);
  }
}

/**
 * env config
 */
const DC_TARGET_GALLERY = readEnvString("DC_TARGET_GALLERY", "").trim();
const DC_TARGET_KEYWORD = readEnvString("DC_TARGET_KEYWORD", "").trim();
const DC_TARGET_DATE_RANGE = readEnvString("DC_TARGET_DATE_RANGE", "").trim();
const DC_TARGET_COMMENT_COUNT = readEnvNumber("DC_TARGET_COMMENT_COUNT", 0);
const DC_RECOMMEND_LINK = readEnvString("DC_RECOMMEND_LINK", "http://monio.co.kr/").trim();
const DC_COMMENT_LANGUAGE = readEnvString("DC_COMMENT_LANGUAGE", "ko").trim();

const HEADLESS = readEnvBool("BOT_HEADLESS", false);

const USER_DATA_DIR_MODE = normalizeUserDataDirMode(
  readEnvString("USER_DATA_DIR_MODE", "persistent").trim(),
);

const LOGIN_WAIT_TIMEOUT_MS = readEnvNumber("BOT_LOGIN_WAIT_TIMEOUT_MS", 10 * 60 * 1000);
const STANDBY_POLL_MS = readEnvNumber("BOT_STANDBY_POLL_MS", 2000);

/**
 * 댓글 작업 가능 여부
 */
function hasCommentJobConfig() {
  return Boolean(
    DC_TARGET_GALLERY &&
    DC_TARGET_KEYWORD &&
    DC_RECOMMEND_LINK &&
    DC_TARGET_COMMENT_COUNT > 0
  );
}

/**
 * 실행 설정 로그
 */
function getRunSummary() {
  return {
    userDataRoot: USER_DATA_ROOT,
    headless: HEADLESS,
    userDataDirMode: USER_DATA_DIR_MODE,
    manualLogin: true,
    loginWaitTimeoutMs: LOGIN_WAIT_TIMEOUT_MS,
    standbyPollMs: STANDBY_POLL_MS,
    commentJob: hasCommentJobConfig(),
    gallery: DC_TARGET_GALLERY,
    keyword: DC_TARGET_KEYWORD,
    dateRange: DC_TARGET_DATE_RANGE,
    count: DC_TARGET_COMMENT_COUNT,
    recommendLink: DC_RECOMMEND_LINK,
    commentLanguage: DC_COMMENT_LANGUAGE,
  };
}

/**
 * runner 상태
 */
let isStopping = false;
let signalsBound = false;

/**
 * 종료 시그널 바인딩
 */
function bindShutdownSignals() {
  if (signalsBound) return;
  signalsBound = true;

  const onStop = (signal) => {
    console.log(`[runDcinside] stop signal received: ${signal}`);
    isStopping = true;
  };

  process.on("SIGINT", onStop);
  process.on("SIGTERM", onStop);

  try {
    if (process.parentPort) {
      process.parentPort.on("message", (event) => {
        const message = event?.data || event;

        if (message?.type === "stop") {
          console.log("[runDcinside] stop message received");
          isStopping = true;
        }
      });
    }
  } catch {
    /** ignore */
  }

  try {
    process.on("message", (message) => {
      if (message?.type === "stop") {
        console.log("[runDcinside] stop message received");
        isStopping = true;
      }
    });
  } catch {
    /** ignore */
  }
}

/**
 * post-run 대기
 */
async function waitForStandby(tag = "standby") {
  console.log(`[runDcinside] entering ${tag}`);

  while (!isStopping) {
    await sleep(STANDBY_POLL_MS);
  }

  console.log(`[runDcinside] leaving ${tag}`);
}

/**
 * 객체를 한 줄 로그 문자열로 변환한다.
 */
function toOneLineLog(obj) {
  return Object.entries(obj)
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join(" ");
}

/**
 * DCInside runner
 */
async function runDcinside() {
  console.log("[runDcinside] runner started");
  console.log("[runDcinside] config:", toOneLineLog(getRunSummary()));

  bindShutdownSignals();

  let page = null;
  let opened = null;
  let runResult = null;

  try {
    /**
     * 1) 사이트 진입
     */
    opened = await enterSite({
      headless: HEADLESS,
      storageKey: "dc_main",
      localeProfileKey: "kr",
      userDataDirMode: USER_DATA_DIR_MODE,
      useMobile: true,
    });

    page = opened?.page;

    if (!page) {
      throw new Error("DCInside page was not created");
    }

    console.log("[runDcinside] entered site");

    /**
     * 2) 지정한 방식의 프로필로 수동 로그인 대기
     */
    console.log("[runDcinside] waiting for manual login");

    page = await ensureDcinsideLoggedIn(page, {
      timeout: LOGIN_WAIT_TIMEOUT_MS,
    });

    console.log("[runDcinside] login detected");

    if (USER_DATA_DIR_MODE === "promote") {
      armProfilePromotion(opened.browser);
    }

    appendHistory({
      action: "manualLoginWait",
      status: "success",
      config: {
        timeoutMs: LOGIN_WAIT_TIMEOUT_MS,
      },
    });

    /**
     * 3) 댓글 자동 게시 작업
     */
    if (hasCommentJobConfig()) {
      console.log("[runDcinside] comment job starting", {
        gallery: DC_TARGET_GALLERY,
        keyword: DC_TARGET_KEYWORD,
        dateRange: DC_TARGET_DATE_RANGE,
        count: DC_TARGET_COMMENT_COUNT,
        commentLanguage: DC_COMMENT_LANGUAGE,
      });

      const result = await commentOnSearchResults(page, {
        gallery: DC_TARGET_GALLERY,
        keyword: DC_TARGET_KEYWORD,
        dateRange: DC_TARGET_DATE_RANGE,
        count: DC_TARGET_COMMENT_COUNT,
        createCommentText: async ({ post }) => {
          return createDcinsideCommentRecommendingLink({
            gallery: DC_TARGET_GALLERY,
            title: post.title,
            link: DC_RECOMMEND_LINK,
            language: DC_COMMENT_LANGUAGE,
          });
        },
      });

      page = result?.page || page;

      appendHistory({
        action: "commentOnSearchResults",
        status: "success",
        config: {
          gallery: DC_TARGET_GALLERY,
          keyword: DC_TARGET_KEYWORD,
          dateRange: DC_TARGET_DATE_RANGE,
          count: DC_TARGET_COMMENT_COUNT,
          commentLanguage: DC_COMMENT_LANGUAGE,
          recommendLink: DC_RECOMMEND_LINK,
        },
        result: {
          urls: Array.isArray(result?.urls) ? result.urls : [],
          total: Array.isArray(result?.urls) ? result.urls.length : 0,
          failures: Array.isArray(result?.failures) ? result.failures : [],
        },
      });

      console.log("[runDcinside] comment job completed");

      runResult = {
        ok: true,
        action: "comment",
        result,
      };
    } else {
      console.log("[runDcinside] no comment job config, standby after login");

      appendHistory({
        action: "idleStandby",
        status: "success",
        config: {
          manualLogin: true,
        },
      });

      runResult = {
        ok: true,
        action: "idleStandby",
      };
    }

    /**
     * 4) crawl 관련 코드는 일단 별도 보관
     *
     * await crawl(page, {
     *   tab: "전체",
     *   date: "26.02.09~26.02.09",
     *   recommend: false,
     *   keyword: "볼",
     *   amount: 20,
     *   outDir: "./out",
     * });
     */

    /**
     * 5) 작업 종료 후 브라우저 유지
     */
    await waitForStandby("post-run-standby");

    return runResult;
  } catch (err) {
    const message = String(err?.message || err || "Unknown error");

    console.error("[runDcinside] failed:", message);

    appendHistory({
      action: hasCommentJobConfig() ? "commentOnSearchResults" : "idleStandby",
      status: "error",
      error: message,
      config: {
        gallery: DC_TARGET_GALLERY,
        keyword: DC_TARGET_KEYWORD,
        dateRange: DC_TARGET_DATE_RANGE,
        count: DC_TARGET_COMMENT_COUNT,
        commentLanguage: DC_COMMENT_LANGUAGE,
      },
    });

    throw err;
  } finally {
    if (USER_DATA_DIR_MODE === "promote") {
      try {
        const promoted = await finalizeProfilePromotion(opened?.browser);

        console.log("[runDcinside] profile promotion finalized", {
          promoted,
          storageKey: "dc_main",
        });
      } catch (promoteErr) {
        console.error(
          "[runDcinside] profile promotion failed:",
          promoteErr?.message || promoteErr,
        );
      }
    }

    await closeAll().catch((closeErr) => {
      console.error("[runDcinside] closeAll failed:", closeErr?.message || closeErr);
    });
  }
}

if (require.main === module) {
  runDcinside().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}

module.exports = runDcinside;