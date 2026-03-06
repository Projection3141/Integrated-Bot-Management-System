/**
 * platforms/reddit/redditBot.js
 *
 * =============================================================================
 * Reddit 고수준 기능 API
 * =============================================================================
 *
 * 이 파일은 "외부에서 실제로 사용하는 기능"만 노출한다.
 *
 * 제공 기능:
 *
 * 1) enterSite()
 *    - Reddit 진입
 *    - temp profile 사용 가능
 *    - page/browser 반환
 *
 * 2) gotoUrlSafe()
 *    - detached frame 대응 포함 안전 이동
 *
 * 3) loginRedditAuto(page, { username, password })
 *    - Reddit 로그인 페이지 이동
 *    - shadow DOM 기반 username/password 입력
 *    - 로그인 버튼 클릭
 *
 * 4) searchAndScroll(page, { keyword, rounds, delayMs })
 *    - 검색 페이지 이동
 *    - 여러 번 스크롤하여 결과 lazy load 유도
 *
 * 5) enterSubreddit(page, subredditName)
 *    - 특정 서브레딧 진입
 *
 * 6) createTextPost(page, { pickValue, title, body })
 *    - u/... 또는 r/... 기준 submit URL 직접 구성
 *    - 제목 입력
 *    - 본문 입력
 *    - 게시 버튼 클릭
 *
 * 7) createComment(page, { url, commentText })
 *    - 글 URL 이동
 *    - 댓글 버튼 클릭
 *    - 댓글 editor 탐색
 *    - 댓글 입력
 *    - 댓글 등록
 *
 * 설계 포인트:
 *  - 이 파일은 "흐름 제어"에 집중한다.
 *  - 실제 DOM 조작, shadow DOM 접근, BFS 탐색 등은
 *    redditInternals.js가 담당한다.
 * =============================================================================
 */

const { openPage } = require("../../core/browserEngine");
const { sleep } = require("../../core/helpers");
const {
  gotoUrlSafe,
  safeWaitNetworkIdle,
} = require("../../core/navigation");

const {
  buildSearchUrl,
  buildTextSubmitUrlFromPickValue,

  setFaceplateTextInputById,
  clickLoginButton,

  setTitleFaceplateTextarea,
  setBodyLexicalRTE,
  clickSubmitPostButton,

  clickCommentsActionButton,
  scrollToCommentsArea,
  focusCommentEditorDeepStrict,
  setCommentTextByKeyboard,
  clickCommentSubmitButtonDeep,
} = require("./redditInternals");

/** ****************************************************************************
 * 1) Reddit 진입
 *
 * 단계:
 *  - 공통 browserEngine.openPage() 사용
 *  - Reddit은 detached frame 이슈를 줄이기 위해 temp profile 기본 사용
 *  - 첫 진입 URL은 기본적으로 reddit.com
 ******************************************************************************/
async function enterSite({
  targetUrl = "https://www.reddit.com/",
  profileKey = "reddit_kr",
  headless = false,
  viewport = { width: 1280, height: 900 },
  useTempProfile = true,
} = {}) {
  return openPage({
    url: targetUrl,
    profileKey,
    headless,
    viewport,
    userDataDirMode: useTempProfile ? "temp" : "persistent",
    acceptLanguage: "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
    timezone: "Asia/Seoul",
    tag: "reddit.page",
  });
}

/** ****************************************************************************
 * 2) Reddit 로그인
 *
 * 단계:
 *  - login URL로 안전 이동
 *  - username shadow input 입력
 *  - password shadow input 입력
 *  - 로그인 버튼 클릭
 *  - network idle 대기
 *
 * 반환:
 *  - 최신 page 객체
 ******************************************************************************/
async function loginRedditAuto(page, { username, password } = {}) {
  if (!username) throw new Error("loginRedditAuto: username is required");
  if (!password) throw new Error("loginRedditAuto: password is required");

  page = await gotoUrlSafe(page, "https://www.reddit.com/login/", {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });

  await setFaceplateTextInputById(page, "login-username", username, 30000);
  await sleep(150);
  await setFaceplateTextInputById(page, "login-password", password, 30000);
  await sleep(200);

  await clickLoginButton(page, 30000);
  await safeWaitNetworkIdle(page, 20000);
  await sleep(600);

  return page;
}

/** ****************************************************************************
 * 3) 검색 + 스크롤
 *
 * 단계:
 *  - 검색 URL 생성
 *  - 안전 이동
 *  - 여러 번 스크롤
 *  - 스크롤 후 network idle 대기
 ******************************************************************************/
async function searchAndScroll(page, { keyword, rounds = 4, delayMs = 900 } = {}) {
  if (!keyword) throw new Error("searchAndScroll: keyword is required");

  page = await gotoUrlSafe(page, buildSearchUrl(keyword), {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });

  await safeWaitNetworkIdle(page, 15000);

  for (let i = 0; i < rounds; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    // eslint-disable-next-line no-await-in-loop
    await sleep(delayMs);
    // eslint-disable-next-line no-await-in-loop
    await safeWaitNetworkIdle(page, 8000);

    console.log(`[reddit][search] scroll ${i + 1}/${rounds}`);
  }

  return page;
}

/** ****************************************************************************
 * 4) 서브레딧 진입
 ******************************************************************************/
async function enterSubreddit(page, subredditName) {
  if (!subredditName) throw new Error("enterSubreddit: subredditName is required");

  const url = `https://www.reddit.com/r/${encodeURIComponent(String(subredditName))}/`;

  page = await gotoUrlSafe(page, url, {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });

  await safeWaitNetworkIdle(page, 12000);
  return page;
}

/** ****************************************************************************
 * 5) 텍스트 글 작성
 *
 * 단계:
 *  - pickValue(u/... 또는 r/...)를 submit URL로 변환
 *  - submit page 이동
 *  - 제목 입력
 *  - 본문 입력
 *  - 게시 버튼 클릭
 *  - network idle 대기
 ******************************************************************************/
async function createTextPost(page, { pickValue, title, body } = {}) {
  if (!page) throw new Error("createTextPost: page is required");
  if (!pickValue) throw new Error("createTextPost: pickValue is required");

  const submitUrl = buildTextSubmitUrlFromPickValue(pickValue);
  console.log("[reddit][post] direct submit url:", submitUrl);

  page = await gotoUrlSafe(page, submitUrl, {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });

  await safeWaitNetworkIdle(page, 12000);
  await sleep(600);

  await setTitleFaceplateTextarea(page, title, 30000);
  await sleep(200);

  await setBodyLexicalRTE(page, body, 30000);
  await sleep(300);

  await clickSubmitPostButton(page, 30000);
  await safeWaitNetworkIdle(page, 20000);
  await sleep(800);

  return page;
}

/** ****************************************************************************
 * 6) 댓글 작성
 *
 * 단계:
 *  - 대상 글 URL 이동
 *  - comments 버튼 클릭
 *  - 댓글 섹션 근처 스크롤
 *  - 댓글 editor 깊은 탐색
 *  - 텍스트 입력
 *  - 등록 버튼 클릭
 ******************************************************************************/
async function createComment(page, { url, commentText } = {}) {
  if (!page) throw new Error("createComment: page is required");
  if (!url) throw new Error("createComment: url is required");
  if (!commentText) throw new Error("createComment: commentText is required");

  page = await gotoUrlSafe(page, url, {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });

  await safeWaitNetworkIdle(page, 12000);
  await sleep(700);

  await clickCommentsActionButton(page, 15000);
  await safeWaitNetworkIdle(page, 10000);
  await sleep(700);

  await scrollToCommentsArea(page, { rounds: 8, step: 900 });
  await safeWaitNetworkIdle(page, 10000);
  await sleep(600);

  await focusCommentEditorDeepStrict(page, { timeout: 25000 });
  await sleep(150);

  await setCommentTextByKeyboard(page, commentText);
  await sleep(250);

  await clickCommentSubmitButtonDeep(page, 20000);
  await safeWaitNetworkIdle(page, 15000);
  await sleep(800);

  return page;
}

module.exports = {
  enterSite,
  gotoUrlSafe,
  loginRedditAuto,
  searchAndScroll,
  enterSubreddit,
  createTextPost,
  createComment,
};