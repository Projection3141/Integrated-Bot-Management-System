/**
 * core/resolveChromePath.js
 *
 * =============================================================================
 * CHROME EXECUTABLE RESOLVER
 * =============================================================================
 *
 * 역할:
 *  - Electron 개발 환경과 빌드 환경에서 Chrome 실행 파일 경로를 찾음
 *  - 빌드 앱에서는 extraResources로 포함된 Chrome for Testing을 우선 사용
 *  - 개발 환경에서는 vendor/chrome 안의 Chrome을 우선 사용
 *  - 마지막 fallback으로 PC에 설치된 Chrome을 탐색
 * =============================================================================
 */

const fs = require("fs");
const path = require("path");

function exists(filePath) {
  return !!filePath && fs.existsSync(filePath);
}

function getProjectRoot() {
  /**
   * 개발 환경 기준.
   * core/resolveChromePath.js -> project root
   */
  return path.resolve(__dirname, "..");
}

function getResourcesRoot() {
  /**
   * 빌드 환경:
   *   process.resourcesPath = .../resources
   *
   * 개발 환경:
   *   process.resourcesPath가 없거나 Electron 내부 경로일 수 있으므로 project root 사용
   */
  if (process.resourcesPath && fs.existsSync(process.resourcesPath)) {
    return process.resourcesPath;
  }

  return getProjectRoot();
}

function collectChromeCandidates() {
  const projectRoot = getProjectRoot();
  const resourcesRoot = getResourcesRoot();

  return [
    /**
     * 빌드 환경 extraResources:
     * resources/chrome/chrome/win64-138.0.7204.168/chrome-win64/chrome.exe
     */
    path.join(
      resourcesRoot,
      "chrome",
      "chrome",
      "win64-138.0.7204.168",
      "chrome-win64",
      "chrome.exe"
    ),

    /**
     * 개발 환경:
     * vendor/chrome/chrome/win64-138.0.7204.168/chrome-win64/chrome.exe
     */
    path.join(
      projectRoot,
      "vendor",
      "chrome",
      "chrome",
      "win64-138.0.7204.168",
      "chrome-win64",
      "chrome.exe"
    ),

    /**
     * 일반 설치 Chrome fallback.
     */
    process.env.CHROME_PATH,

    path.join(
      process.env.PROGRAMFILES || "C:\\Program Files",
      "Google",
      "Chrome",
      "Application",
      "chrome.exe"
    ),

    path.join(
      process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)",
      "Google",
      "Chrome",
      "Application",
      "chrome.exe"
    ),

    path.join(
      process.env.LOCALAPPDATA || "",
      "Google",
      "Chrome",
      "Application",
      "chrome.exe"
    )
  ].filter(Boolean);
}

function resolveChromePath() {
  const candidates = collectChromeCandidates();

  const found = candidates.find((candidate) => exists(candidate));

  if (!found) {
    throw new Error(
      [
        "Chrome executable not found.",
        "Run `npm run download:chrome` before build, or install Google Chrome.",
        "",
        "Checked paths:",
        ...candidates.map((candidate) => `- ${candidate}`)
      ].join("\n")
    );
  }

  return found;
}

module.exports = {
  resolveChromePath
};