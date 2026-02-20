/**
 * runInstaPost.js
 * - 브라우저 뜸 → 사용자가 로그인 수동 → Enter → 업로드 자동 진행
 */

const path = require("path");
const readline = require("readline");

const {
  enterSite,
  postInstaCustom,
  uploadImageinInstaPostCustom,
  setCaptionAndShareCustom,
} = require("../instaBot");

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
  const caption = "테스트 업로드";
  const imagePath = path.normalize("public\\assets\\image\\cat.jpg");

  const { browser, page } = await enterSite({
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

    console.log("[runInstaPost] ✅ done");
  } catch (e) {
    console.error("[runInstaPost] ❌ failed:", e?.message || e);
    process.exitCode = 1;
  } finally {
    await browser.close().catch(() => {});
  }
})();
