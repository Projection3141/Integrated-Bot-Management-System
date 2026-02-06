/* ============================================================
FILE: app.js  (예: 실행만)
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

  // await crawl(page, "메이드", { limit: 10, outDir: "./out" });

  await gotoUrl(page, "https://m.dcinside.com/board/rollthechess/2980147?headid=40");

  await comment(page, "맛있다");

  await sleep(600000);
  await closeAll();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
