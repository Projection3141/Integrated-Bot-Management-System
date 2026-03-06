/**
 * platforms/dcinside/runDcinside.js
 *
 * =============================================================================
 * DCInside 실행 스크립트
 * =============================================================================
 *
 * 사용법:
 *   npm run dc
 *
 * 환경변수 예시(Windows PowerShell):
 *   $env:DC_ID="your_id"
 *   $env:DC_PW="your_pw"
 *   npm run dc
 *
 * 이 runner는 기존 app.js의 흐름을 그대로 옮긴 예시다.
 * 필요한 단계만 주석 해제해서 사용하면 된다.
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

(async () => {
  const { page } = await enterSite({
    startUrl: "https://m.naver.com",
    targetUrl: "https://m.dcinside.com",
    profileKey: "dc_kr",
    headless: false,
    searchQuery: "디시인사이드",
  });

  try {
    if (DC_ID && DC_PW) {
      await login(page, { id: DC_ID, pw: DC_PW });
    } else {
      console.log("[runDcinside] login skipped: set DC_ID / DC_PW env if needed");
    }

    /** 갤러리 진입 예시 */
    await enterGallary(page, "트릭컬");

    /** 검색만 따로 쓰고 싶으면 */
    // await search(page, "트릭컬");

    /** 크롤링 예시 */
    // await crawl(page, {
    //   tab: "전체",
    //   date: "26.02.09~26.02.09",
    //   recommend: false,
    //   keyword: "볼",
    //   amount: 20,
    //   outDir: "./out",
    // });

    /** URL 직접 이동 예시 */
    // await gotoUrl(page, "https://m.dcinside.com/board/rollthechess/2982674");

    /** 댓글 예시 */
    // await comment(page, "진짜 말 안듣게 생겼네");

    await sleep(600000);
  } catch (e) {
    console.error("[runDcinside] ❌ failed:", e?.message || e);
    process.exitCode = 1;
  } finally {
    await closeAll();
  }
})();