/**
 * core/helpers.js
 *
 * =============================================================================
 * 공통 유틸 모음
 * =============================================================================
 *
 * 역할:
 *  1) sleep
 *  2) 디렉터리 생성
 *  3) 절대경로 변환
 *  4) 파일 읽기 가능 여부 확인
 *  5) 일반 DOM 클릭
 *  6) 일반 input / textarea 값 입력
 *
 * 주의:
 *  - Shadow DOM 전용 제어는 각 플랫폼 internals 파일에서 처리한다.
 *  - 여기서는 공통으로 재사용 가능한 가장 기본 유틸만 둔다.
 * =============================================================================
 */

const fs = require("fs");
const path = require("path");
const { clickInFrame, fillInFrame, withLiveFrame } = require("./navigation");

/** ****************************************************************************
 * 시간 지연
 ******************************************************************************/
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** ****************************************************************************
 * 디렉터리 보장
 ******************************************************************************/
function ensureDir(dirPath) {
  try {
    fs.mkdirSync(dirPath, { recursive: true });
  } catch {
    /** ignore */
  }
}

/** ****************************************************************************
 * 존재하는 첫 경로 반환
 ******************************************************************************/
function firstExisting(paths) {
  for (const p of paths) {
    if (!p) continue;
    try {
      if (fs.existsSync(p)) return p;
    } catch {
      /** ignore */
    }
  }
  return null;
}

/** ****************************************************************************
 * 읽기용 앱 리소스 경로 해석
 ******************************************************************************/
function resolveReadablePath(targetPath, { baseDir } = {}) {
  if (!targetPath) {
    throw new Error("resolveReadablePath: targetPath is required");
  }

  if (path.isAbsolute(targetPath)) {
    return targetPath;
  }

  const normalized = String(targetPath).replace(/^[/\\]+/, "");

  const candidates = [
    baseDir ? path.resolve(baseDir, normalized) : null,
    process.env.BOT_APP_ROOT ? path.resolve(process.env.BOT_APP_ROOT, normalized) : null,
    process.env.BOT_RESOURCES_PATH
      ? path.join(process.env.BOT_RESOURCES_PATH, "app.asar.unpacked", normalized)
      : null,
    process.env.BOT_RESOURCES_PATH
      ? path.join(process.env.BOT_RESOURCES_PATH, "app.asar", normalized)
      : null,
    path.resolve(process.cwd(), normalized),
  ];

  return firstExisting(candidates) || candidates.find(Boolean);
}

/** ****************************************************************************
 * 파일 읽기 가능 여부 확인
 ******************************************************************************/
async function assertReadableFile(targetPath, opts = {}) {
  const abs = resolveReadablePath(targetPath, opts);

  await fs.promises.access(abs, fs.constants.R_OK).catch(() => {
    throw new Error(`File not readable: ${abs}`);
  });

  return abs;
}

/** ****************************************************************************
 * DOM action target 결정
 *
 * 설명:
 *  - 기본: 전달받은 page/frame 자체를 사용
 *  - framePredicate가 있으면 page 기준으로 live frame 재획득 후 사용
 ******************************************************************************/
async function withDomTarget(pageOrFrame, task, opts = {}) {
  if (!pageOrFrame) throw new Error("withDomTarget: pageOrFrame is required");
  if (typeof task !== "function") throw new Error("withDomTarget: task must be a function");

  const {
    framePredicate,
    timeout = 10000,
    pollInterval = 100,
    tag = "withDomTarget",
  } = opts;

  /** framePredicate가 없으면 현재 target 그대로 사용 */
  if (typeof framePredicate !== "function") {
    return task(pageOrFrame);
  }

  /** framePredicate를 쓸 때는 page가 필요 */
  if (typeof pageOrFrame.frames !== "function") {
    throw new Error("withDomTarget: framePredicate requires a page target");
  }

  return withLiveFrame(
    pageOrFrame,
    framePredicate,
    async (frame) => task(frame),
    { timeout, pollInterval, tag: `${tag}:frame` }
  );
}

/** ****************************************************************************
 * 일반 DOM 클릭
 *
 * 설명:
 *  - 기본은 전달받은 page/frame target에서 클릭
 *  - framePredicate가 있으면 live frame 재획득 후 클릭
 *
 * 용도:
 *  - 일반 DOM 기반 사이트
 *  - iframe 내부 일반 DOM 액션 공통 처리
 ******************************************************************************/
async function domClick(pageOrFrame, selector, opts = {}) {
  if (!pageOrFrame) throw new Error("domClick: pageOrFrame is required");
  if (!selector) throw new Error("domClick: selector is required");

  const {
    timeout = 10000,
    pollInterval = 100,
    framePredicate,
    tag = "domClick",
  } = opts;

  await withDomTarget(
    pageOrFrame,
    async (target) => {
      await clickInFrame(target, selector, { timeout, tag });
    },
    { framePredicate, timeout, pollInterval, tag }
  );

  return true;
}

/** ****************************************************************************
 * 일반 input/textarea 값 입력
 *
 * 설명:
 *  - 기본은 전달받은 page/frame target에서 값 입력
 *  - framePredicate가 있으면 live frame 재획득 후 입력
 *
 * 용도:
 *  - 일반 입력 필드
 *  - iframe 내부 일반 DOM 입력 공통 처리
 ******************************************************************************/
async function setValue(pageOrFrame, selector, value, opts = {}) {
  if (!pageOrFrame) throw new Error("setValue: pageOrFrame is required");
  if (!selector) throw new Error("setValue: selector is required");

  const {
    timeout = 20000,
    pollInterval = 100,
    framePredicate,
    tag = "setValue",
  } = opts;

  await withDomTarget(
    pageOrFrame,
    async (target) => {
      await fillInFrame(target, selector, String(value ?? ""), { timeout, tag });
    },
    { framePredicate, timeout, pollInterval, tag }
  );

  return true;
}

module.exports = {
  sleep,
  ensureDir,
  resolveReadablePath,
  assertReadableFile,
  domClick,
  setValue,
};