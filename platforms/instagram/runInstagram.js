/**
 * platforms/instagram/runInstagram.js
 *
 * =============================================================================
 * Instagram 실행 스크립트
 * =============================================================================
 *
 * 사용법:
 *   npm run instagram
 *
 * 흐름:
 *  1) 브라우저 열기
 *  2) 사용자가 수동 로그인
 *  3) Enter 입력
 *  4) Create
 *  5) Upload
 *  6) Caption
 *  7) Share
 * =============================================================================
 */

/* eslint-disable no-console */
const path = require("path");
const readline = require("readline");

const {
  enterSite,
  postInstaCustom,
  uploadImageinInstaPostCustom,
  setCaptionAndShareCustom,
} = require("./instaBot");
const { closeAll } = require("../../core/browserEngine");

function waitEnter() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question("✅ 브라우저에서 로그인 완료 후 Enter 누르세요: ", () => {
      rl.close();
      resolve();
    });
  });
}

(async () => {
  const caption = process.env.INSTA_CAPTION || "테스트 업로드";
  const imagePath = process.env.INSTA_IMAGE_PATH || path.normalize("public\\assets\\image\\cat.jpg");

  const { page } = await enterSite({
    headless: false,
    profileKey: "insta_kr",
    targetUrl: "https://www.instagram.com/",
  });

  try {
    await waitEnter();

    console.log("[insta] create flow");
    await postInstaCustom(page);

    console.log("[insta] upload image + next x2");
    await uploadImageinInstaPostCustom(page, imagePath);

    console.log("[insta] caption + share");
    await setCaptionAndShareCustom(page, caption);

    console.log("[runInstagram] ✅ done");
  } catch (e) {
    console.error("[runInstagram] ❌ failed:", e?.message || e);
    process.exitCode = 1;
  } finally {
    await closeAll();
  }
})();