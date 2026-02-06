/**
 * profile = 실행 환경 "레시피" (locale/timezone/headers/chrome args 등)
 * - JSON 파일로 뽑지 말고 코드로 두면 확장/컴포즈(merge) 하기 좋음
 */
const PROFILES = Object.freeze({
  /** 대한민국/한국어 */
  kr: {
    key: "kr",
    locale: "ko-KR",
    timezone: "Asia/Seoul",
    acceptLanguage: "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
    chromeArgs: ["--lang=ko-KR"],
  },

  /** 미국/영어 */
  en: {
    key: "en",
    locale: "en-US",
    timezone: "America/Los_Angeles",
    acceptLanguage: "en-US,en;q=0.9",
    chromeArgs: ["--lang=en-US"],
  },

  /** 일본/일본어 */
  jp: {
    key: "jp",
    locale: "ja-JP",
    timezone: "Asia/Tokyo",
    acceptLanguage: "ja-JP,ja;q=0.9,en-US;q=0.7,en;q=0.6",
    chromeArgs: ["--lang=ja-JP"],
  },
});

/**
 * profile resolver
 * @param {string|object|undefined} profile - "kr" 같은 키 or 커스텀 객체
 * @returns {object}
 */
function resolveProfile(profile) {
  /** (1) 아무것도 없으면 kr 기본 */
  if (!profile) return PROFILES.kr;

  /** (2) 문자열이면 등록된 profile key로 resolve */
  if (typeof profile === "string") {
    return PROFILES[profile] || { ...PROFILES.kr, key: profile };
  }

  /** (3) 객체면 kr를 베이스로 머지 (커스텀) */
  return {
    ...PROFILES.kr,
    ...profile,
    key: profile.key || "custom",
    chromeArgs: Array.isArray(profile.chromeArgs) ? profile.chromeArgs : PROFILES.kr.chromeArgs,
  };
}

module.exports = { PROFILES, resolveProfile };
