/**
 * platforms/instagram/runInstagram.js
 *
 * =============================================================================
 * INSTAGRAM RUNNER
 * =============================================================================
 *
 * 역할:
 *  - Instagram 업로드 시나리오 실행
 *  - 수동 로그인 후 Enter 입력
 *  - Create -> Upload -> Caption -> Share 진행
 *
 * 구조:
 *  - runInstagram()를 export
 *  - 직접 실행 / Electron child process 모두 지원
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

const HEADLESS =
  process.env.BOT_HEADLESS === "1";

function waitEnter() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question("✅ 브라우저에서 로그인 완료 후 Enter 누르세요: ", () => {
      rl.close();
      resolve();
    });
  });
}

async function runInstagram() {
  const caption = process.env.INSTA_CAPTION || "테스트 업로드";
  const imagePath = process.env.INSTA_IMAGE_PATH || path.normalize("public\\assets\\image\\cat.jpg");

  const { page } = await enterSite({
    headless: HEADLESS,
    storageKey: "instagram_main",
    localeProfileKey: "kr",
    useMobile: false,
  });

  try {
    /** --------------------------------------------------------
     * 1) 로그인은 수동
     * ------------------------------------------------------- */
    await waitEnter();

    /** --------------------------------------------------------
     * 2) Create 열기
     * ------------------------------------------------------- */
    console.log("[insta] create flow");
    await postInstaCustom(page);

    /** --------------------------------------------------------
     * 3) 이미지 업로드 + 다음 2회
     * ------------------------------------------------------- */
    console.log("[insta] upload image + next x2");
    await uploadImageinInstaPostCustom(page, imagePath);

    /** --------------------------------------------------------
     * 4) 캡션 입력 + 공유하기
     * ------------------------------------------------------- */
    console.log("[insta] caption + share");
    await setCaptionAndShareCustom(page, caption);

    console.log("[runInstagram] ✅ done");
  } catch (e) {
    console.error("[runInstagram] ❌ failed:", e?.message || e);
    throw e;
  } finally {
    await closeAll();
  }
}

if (require.main === module) {
  runInstagram().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
}

module.exports = runInstagram;