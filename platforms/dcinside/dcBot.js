/**
 * platforms/dcinside/dcBot.js
 *
 * =============================================================================
 * DCInside 고수준 기능 API
 * =============================================================================
 *
 * 제공 기능:
 *
 * 1) enterSite()
 *    - 시작 페이지(보통 네이버 모바일) 열기
 *    - 네이버 검색으로 디시인사이드 찾기
 *    - 결과 클릭
 *    - 최종 targetUrl 보정
 *
 * 2) login(page, { id, pw })
 *    - 로그인 버튼 진입
 *    - 아이디/비밀번호 입력
 *    - 엔터 로그인
 *    - 로그인 후 m.dcinside.com 복귀 박스 대응
 *
 * 3) search(page, keyword)
 *    - 상단 검색창으로 검색
 *
 * 4) enterGallary(page, keyword)
 *    - 검색 수행
 *    - 첫 갤러리 클릭
 *
 * 5) crawl(page, opts)
 *    - 탭/추천/날짜/키워드/수량 기준 크롤링
 *    - JSON 저장 후 파일 경로 반환
 *
 * 6) gotoUrl(page, url)
 *    - 안전 이동
 *
 * 7) comment(page, text)
 *    - 댓글 textarea 입력
 *    - 등록 버튼 클릭
 *
 * 주의:
 *  - 기존 함수명 호환을 위해 enterGallary 오탈자 이름도 유지한다.
 *  - 실제 저수준 DOM 처리는 dcInternals.js에 둔다.
 * =============================================================================
 */

const { openPage } = require("../../core/browserEngine");
const { gotoUrlSafe } = require("../../core/navigation");

const {
  naverSearchWithGivenInput,
  clickFirstDcinsideResult,
  loginDcinside,

  searchGallary,
  clickFirstGalleryFromResult,

  crawlGallary,
  writeComment,
} = require("./dcInternals");

/** ****************************************************************************
 * 1) 사이트 진입
 *
 * 단계:
 *  - startUrl로 진입
 *  - 네이버 검색창에 searchQuery 입력
 *  - 검색 결과 중 dcinside 첫 링크 클릭
 *  - targetUrl과 다르면 최종 보정 이동
 ******************************************************************************/
async function enterSite({
  startUrl = "https://m.naver.com",
  targetUrl = "https://m.dcinside.com",
  storageKey = "dc_main",
  localeProfileKey = "kr",
  headless = false,
  searchQuery = "디시인사이드",
  viewport = { width: 430, height: 932 },
  useMobile = true,
} = {}) {
  const { browser, page } = await openPage({
    url: startUrl,
    storageKey,
    localeProfileKey,
    headless,
    viewport,
    userDataDirMode: "persistent",
    useMobile,
    tag: "dc.page",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox"
    ]
  });

  await naverSearchWithGivenInput(page, searchQuery);
  const targetPage = await clickFirstDcinsideResult(page, browser);

  if (!targetPage.url().startsWith(targetUrl)) {
    await targetPage.goto(targetUrl, { waitUntil: "domcontentloaded" });
  }

  return { browser, page: targetPage };
}

/** ****************************************************************************
 * 2) 로그인
 ******************************************************************************/
async function login(page, { id, pw } = {}) {
  return loginDcinside(page, { id, pw });
}

/** ****************************************************************************
 * 3) 검색
 ******************************************************************************/
async function search(page, keyword) {
  return searchGallary(page, keyword);
}

/** ****************************************************************************
 * 4) 갤러리 진입
 *
 * 단계:
 *  - search(keyword)
 *  - 결과 첫 갤러리 클릭
 *
 * 호환:
 *  - 기존 코드의 오탈자 함수명 enterGallary 유지
 *  - 새 코드에서는 enterGallery 별칭도 같이 제공
 ******************************************************************************/
async function enterGallary(page, keyword) {
  if (!page) throw new Error("enterGallary: page is required");
  if (!keyword) throw new Error("enterGallary: keyword is required");

  await searchGallary(page, keyword);
  return clickFirstGalleryFromResult(page);
}

/** 별칭 */
async function enterGallery(page, keyword) {
  return enterGallary(page, keyword);
}

/** ****************************************************************************
 * 5) 크롤링
 ******************************************************************************/
async function crawl(page, opts = {}) {
  return crawlGallary(page, opts);
}

/** ****************************************************************************
 * 6) 안전 이동
 ******************************************************************************/
async function gotoUrl(page, url, opts = {}) {
  return gotoUrlSafe(page, url, opts);
}

/** ****************************************************************************
 * 7) 댓글 작성
 ******************************************************************************/
async function comment(page, text) {
  return writeComment(page, text);
}

module.exports = {
  enterSite,
  login,
  search,
  enterGallary,
  enterGallery,
  crawl,
  gotoUrl,
  comment,
};