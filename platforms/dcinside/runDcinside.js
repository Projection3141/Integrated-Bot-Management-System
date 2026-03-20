/**
 * platforms/dcinside/runDcinside.js
 *
 * =============================================================================
 * DCINSIDE RUNNER
 * =============================================================================
 *
 * 역할:
 *  - DCInside 자동화 시나리오 실행
 *  - 네이버 경유 진입
 *  - 로그인
 *  - 갤러리 검색/진입
 *  - 크롤링 / 댓글 / 직접 URL 이동 등을 runner에서 선택적으로 수행
 *
 * 구조:
 *  - runDcinside()를 export
 *  - 직접 실행 / Electron child process 모두 지원
 * =============================================================================
 */

/* eslint-disable no-console */
const { closeAll } = require("../../core/browserEngine");
const { sleep } = require("../../core/helpers");
const {
  enterSite,
  login,
  search,
  enterGallary,
  crawl,
  gotoUrl,
  comment,
} = require("./dcBot");

const DC_ID = process.env.DC_ID || "";
const DC_PW = process.env.DC_PW || "";

const HEADLESS =
  process.env.BOT_HEADLESS === "1";

async function runDcinside() {
  const { page } = await enterSite({
    startUrl: "https://m.naver.com",
    targetUrl: "https://m.dcinside.com",
    storageKey: "dc_main",
    localeProfileKey: "kr",
    headless: HEADLESS,
    searchQuery: "디시인사이드",
    useMobile: true,
  });

  try {
    /** --------------------------------------------------------
     * 1) 로그인
     * ------------------------------------------------------- */
    if (DC_ID && DC_PW) {
      await login(page, { id: DC_ID, pw: DC_PW });
    } else {
      console.log("[runDcinside] login skipped: set DC_ID / DC_PW env if needed");
    }

    /** --------------------------------------------------------
     * 2) 예시 동작
     * ------------------------------------------------------- */
    await enterGallary(page, "트릭컬");

    // await search(page, "트릭컬");

    // await crawl(page, {
    //   tab: "전체",
    //   date: "26.02.09~26.02.09",
    //   recommend: false,
    //   keyword: "볼",
    //   amount: 20,
    //   outDir: "./out",
    // });

    // await gotoUrl(page, "https://m.dcinside.com/board/rollthechess/2982674");

    // await comment(page, "진짜 말 안듣게 생겼네");

    /** --------------------------------------------------------
     * 3) 브라우저 유지 시간
     * ------------------------------------------------------- */
    await sleep(600000);
  } catch (e) {
    console.error("[runDcinside] ❌ failed:", e?.message || e);
    throw e;
  } finally {
    await closeAll();
  }
}

if (require.main === module) {
  runDcinside().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
}

module.exports = runDcinside;