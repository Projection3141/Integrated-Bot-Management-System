/* ============================================================
FILE: dcinside/app.js  (예: 실행만)
============================================================ */

/* eslint-disable no-console */
const { closeAll } = require("./chromiumUtil");
const { enterSite, login, search, enterGallary, crawl, gotoUrl, comment } = require("./func");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const DC_ID = "property5596";
const DC_PW = "property5596!!";

(async () => {
  const { page } = await enterSite({
    startUrl: "https://m.naver.com",
    targetUrl: "https://m.dcinside.com",
    profileKey: "kr",
    headless: false,
    searchQuery: "디시인사이드",
  });

  await login(page, { id: DC_ID, pw: DC_PW });

  await enterGallary(page, "트릭컬");

  // await crawl(page, {
  //   tab: "전체",
  //   date: "26. 02.09~26. 02.09",
  //   recommend: false,
  //   keyword: "볼",
  //   amount: 20,
  //   outDir: "./out",
  // });

  // await gotoUrl(page, "https://m.dcinside.com/board/rollthechess/2982674");

  // await comment(page, "진짜 말 안듣게 생겼네");

  await sleep(600000);
  await closeAll();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
