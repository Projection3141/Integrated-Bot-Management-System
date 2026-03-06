/**
 * platforms/instagram/instaBot.js
 *
 * =============================================================================
 * Instagram 고수준 기능 API
 * =============================================================================
 *
 * 제공 기능:
 *
 * 1) enterSite()
 *    - 인스타그램 홈 진입
 *    - persistent profile 기본 사용
 *    - 수동 로그인 세션 유지에 유리
 *
 * 2) gotoUrl()
 *    - 공통 안전 이동 래퍼
 *
 * 3) postInstaCustom(page)
 *    - 홈으로 이동
 *    - Create 아이콘 클릭
 *
 * 4) uploadImageinInstaPostCustom(page, imagePath)
 *    - input[type=file] 업로드
 *    - "다음" 버튼 2회 클릭
 *
 * 5) setCaptionAndShareCustom(page, caption)
 *    - 캡션 영역 클릭
 *    - Lexical editor 입력
 *    - "공유하기" 클릭
 *
 * 6) postInstaWithImagePostOnly()
 *    - 수동 로그인 완료 상태를 가정한 원샷 실행
 *
 * 설계 포인트:
 *  - Instagram은 로그인 세션을 유지하는 것이 중요하므로
 *    persistent profile을 기본값으로 둔다.
 *  - 실제 DOM 클릭/입력 로직은 instaInternals.js에 둔다.
 * =============================================================================
 */

const { openPage } = require("../../core/browserEngine");
const { sleep } = require("../../core/helpers");
const { gotoUrlSafe } = require("../../core/navigation");

const {
  waitForSelectorOrThrow,
  clickRoleButtonDivByText,
  clickCreateByIcon,
  uploadImageFile,
  typeCaptionLexical,
} = require("./instaInternals");

/** ****************************************************************************
 * 1) Instagram 진입
 ******************************************************************************/
async function enterSite({
  targetUrl = "https://www.instagram.com/",
  profileKey = "insta_kr",
  headless = false,
  viewport = { width: 1280, height: 900 },
} = {}) {
  return openPage({
    url: targetUrl,
    profileKey,
    headless,
    viewport,
    userDataDirMode: "persistent",
    acceptLanguage: "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
    timezone: "Asia/Seoul",
    tag: "instagram.page",
  });
}

/** ****************************************************************************
 * 2) 안전 이동
 ******************************************************************************/
async function gotoUrl(page, url, opts = {}) {
  return gotoUrlSafe(page, url, opts);
}

/** ****************************************************************************
 * 3) Create 열기
 *
 * 단계:
 *  - 인스타 홈 이동
 *  - Create 아이콘 클릭
 ******************************************************************************/
async function postInstaCustom(page) {
  if (!page) throw new Error("postInstaCustom: page is required");

  await gotoUrlSafe(page, "https://www.instagram.com/", {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });
  await sleep(600);

  await clickCreateByIcon(page, 30000);
  await sleep(700);

  return page;
}

/** ****************************************************************************
 * 4) 이미지 업로드 + 다음 2회
 ******************************************************************************/
async function uploadImageinInstaPostCustom(page, imagePath) {
  if (!page) throw new Error("uploadImageinInstaPostCustom: page is required");
  if (!imagePath) throw new Error("uploadImageinInstaPostCustom: imagePath is required");

  await uploadImageFile(page, imagePath, 30000);

  await clickRoleButtonDivByText(page, "다음", 30000);
  await sleep(1000);

  await clickRoleButtonDivByText(page, "다음", 30000);
  await sleep(1000);

  return page;
}

/** ****************************************************************************
 * 5) 캡션 입력 + 공유하기
 *
 * 단계:
 *  - caption 영역 대기
 *  - 클릭으로 focus 유도
 *  - Lexical editor 입력
 *  - 공유하기 클릭
 ******************************************************************************/
async function setCaptionAndShareCustom(page, caption) {
  if (!page) throw new Error("setCaptionAndShareCustom: page is required");

  const captionSel =
    'div:has(> div[role="textbox"][aria-placeholder="문구를 입력하세요..."])';

  await waitForSelectorOrThrow(page, captionSel, 30000);

  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return false;
    el.scrollIntoView({ block: "center", inline: "center" });
    el.click();
    return true;
  }, captionSel);

  await sleep(300);

  await typeCaptionLexical(page, caption);
  await sleep(1000);

  await clickRoleButtonDivByText(page, "공유하기", 30000);
  await sleep(1000);

  return page;
}

/** ****************************************************************************
 * 6) 원샷 실행
 *
 * 설명:
 *  - 로그인은 사용자가 수동으로 이미 끝냈다고 가정한다.
 *  - 들어가서 Create → Upload → Caption → Share 까지 수행한다.
 ******************************************************************************/
async function postInstaWithImagePostOnly({
  headless = false,
  profileKey = "insta_kr",
  caption = "test",
  imagePath = "public\\assets\\image\\cat.jpg",
} = {}) {
  const { browser, page } = await enterSite({
    headless,
    profileKey,
    targetUrl: "https://www.instagram.com/",
  });

  try {
    await postInstaCustom(page);
    await uploadImageinInstaPostCustom(page, imagePath);
    await setCaptionAndShareCustom(page, caption);

    console.log("[insta] ✅ done");
    return { ok: true };
  } catch (e) {
    console.error("[insta] ❌ failed:", e?.message || e);
    return { ok: false, error: String(e?.message || e) };
  } finally {
    await browser.close().catch(() => {});
  }
}

module.exports = {
  enterSite,
  gotoUrl,

  postInstaCustom,
  uploadImageinInstaPostCustom,
  setCaptionAndShareCustom,

  postInstaWithImagePostOnly,
};