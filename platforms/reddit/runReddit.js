/**
 * platforms/reddit/runReddit.js
 *
 * =============================================================================
 * Reddit 실행 스크립트
 * =============================================================================
 *
 * 사용법:
 *   npm run reddit
 *
 * 환경변수 예시(Windows PowerShell):
 *   $env:REDDIT_USERNAME="your_id"
 *   $env:REDDIT_PASSWORD="your_pw"
 *   npm run reddit
 *
 * 이 runner는 예시 실행 흐름만 담고 있다.
 * 필요한 단계만 주석 해제해서 사용하면 된다.
 * =============================================================================
 */

/* eslint-disable no-console */
const {
  enterSite,
  loginRedditAuto,
  searchAndScroll,
  enterSubreddit,
  createTextPost,
  createComment,
} = require("./redditBot");
const { closeAll } = require("../../core/browserEngine");
const { sleep } = require("../../core/helpers");

const REDDIT_USERNAME = process.env.REDDIT_USERNAME || "";
const REDDIT_PASSWORD = process.env.REDDIT_PASSWORD || "";

(async () => {
  const { page } = await enterSite({
    headless: false,
    profileKey: "reddit_kr",
    useTempProfile: true,
  });

  try {
    if (REDDIT_USERNAME && REDDIT_PASSWORD) {
      await loginRedditAuto(page, {
        username: REDDIT_USERNAME,
        password: REDDIT_PASSWORD,
      });
    } else {
      console.log("[runReddit] login skipped: set REDDIT_USERNAME / REDDIT_PASSWORD env if needed");
    }

    /** 검색 예시 */
    await searchAndScroll(page, {
      keyword: "cyberpunk edgerunners",
      rounds: 3,
    });

    /** 서브레딧 진입 예시 */
    // await enterSubreddit(page, "javascript");

    /** 텍스트 글 작성 예시 */
    // await createTextPost(page, {
    //   pickValue: "u/YourUsername",
    //   title: "test title",
    //   body: "hello\nthis is a bot test",
    // });

    /** 댓글 작성 예시 */
    // await createComment(page, {
    //   url: "https://www.reddit.com/user/Projection3141/comments/1r9phmt/test_post/",
    //   commentText: "자동 댓글 테스트",
    // });

    await sleep(10000);
  } catch (e) {
    console.error("[runReddit] ❌ failed:", e?.message || e);
    process.exitCode = 1;
  } finally {
    await closeAll();
  }
})();