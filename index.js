/**
 * index.js
 *
 * =============================================================================
 * MULTI PLATFORM BOT ENTRY POINT
 * =============================================================================
 *
 * 역할:
 *  - 프로젝트의 단일 실행 진입점
 *  - 전달받은 명령어에 따라 각 플랫폼 runner를 실행
 *
 * 지원 명령:
 *  1) node index.js reddit
 *  2) node index.js instagram
 *  3) node index.js dc
 *  4) node index.js all
 *
 * 설계 방식:
 *  - 각 runner 파일은 이미 독립 실행형(IIFE) 스크립트이므로
 *    여기서는 require()로 직접 불러 실행하지 않고
 *    child_process.spawn()으로 별도 Node 프로세스로 실행한다.
 *
 * 장점:
 *  - 기존 runReddit.js / runInstagram.js / runDcinside.js 수정 없이 사용 가능
 *  - 각 runner가 process.exitCode, console 출력, 브라우저 종료를 독립적으로 처리 가능
 *  - 추후 scheduler / batch / CI에서 index.js 하나만 호출하면 됨
 * =============================================================================
 */

const path = require("path");
const dotenv = require("dotenv");
dotenv.config();
const { spawn } = require("child_process");

/** ****************************************************************************
 * runner 경로 매핑
 *
 * 설명:
 *  - 플랫폼 이름과 실제 실행 파일을 연결한다.
 *  - index.js 기준 상대경로를 절대경로로 변환해서 사용한다.
 ******************************************************************************/
const RUNNERS = {
  reddit: path.resolve(__dirname, "platforms", "reddit", "runReddit.js"),
  instagram: path.resolve(__dirname, "platforms", "instagram", "runInstagram.js"),
  dc: path.resolve(__dirname, "platforms", "dcinside", "runDcinside.js"),
};

/** ****************************************************************************
 * 단일 runner 실행
 *
 * 단계:
 *  1) 플랫폼 키 검증
 *  2) node <runnerPath> 형태로 새 프로세스 실행
 *  3) stdio: "inherit" 로 부모 터미널에 로그 그대로 출력
 *  4) 종료 코드 반환
 *
 * 반환:
 *  - Promise<number>
 *    runner 종료 code
 ******************************************************************************/
function runRunner(platformKey) {
  return new Promise((resolve, reject) => {
    const runnerPath = RUNNERS[platformKey];

    if (!runnerPath) {
      reject(new Error(`Unknown platform: ${platformKey}`));
      return;
    }

    console.log(`[index] ▶ start: ${platformKey}`);
    console.log(`[index] runner: ${runnerPath}`);

    const child = spawn(process.execPath, [runnerPath], {
      stdio: "inherit",
      env: process.env,
      cwd: process.cwd(),
    });

    /** child process 자체 실행 실패 */
    child.on("error", (err) => {
      reject(err);
    });

    /** child process 종료 */
    child.on("close", (code) => {
      const exitCode = Number.isInteger(code) ? code : 1;

      if (exitCode === 0) {
        console.log(`[index] ✅ done: ${platformKey}`);
      } else {
        console.log(`[index] ❌ failed: ${platformKey} (code=${exitCode})`);
      }

      resolve(exitCode);
    });
  });
}

/** ****************************************************************************
 * all 실행
 *
 * 설명:
 *  - 여러 브라우저 자동화가 동시에 뜨면 세션/포커스/리소스 충돌 가능성이 있으므로
 *    기본은 순차 실행으로 처리한다.
 *
 * 순서:
 *  1) reddit
 *  2) instagram
 *  3) dc
 *
 * 규칙:
 *  - 하나라도 실패하면 즉시 중단하고 해당 종료 코드를 반환
 ******************************************************************************/
async function runAllSequential() {
  const order = ["reddit", "instagram", "dc"];

  for (let i = 0; i < order.length; i += 1) {
    const platformKey = order[i];

    // eslint-disable-next-line no-await-in-loop
    const code = await runRunner(platformKey);

    if (code !== 0) {
      return code;
    }
  }

  return 0;
}

/** ****************************************************************************
 * 도움말 출력
 ******************************************************************************/
function printHelp() {
  console.log(`
Usage:
  node index.js reddit
  node index.js instagram
  node index.js dc
  node index.js all

Examples:
  node index.js reddit
  node index.js instagram
  node index.js dc
  node index.js all
`);
}

/** ****************************************************************************
 * 메인 실행부
 *
 * 단계:
 *  1) argv에서 명령어 추출
 *  2) help / unknown 처리
 *  3) 단일 실행 또는 전체 실행
 *  4) 최종 종료 코드 반영
 ******************************************************************************/
(async () => {
  const command = String(process.argv[2] || "").trim().toLowerCase();

  try {
    if (!command || command === "help" || command === "--help" || command === "-h") {
      printHelp();
      process.exitCode = 0;
      return;
    }

    if (command === "all") {
      const code = await runAllSequential();
      process.exitCode = code;
      return;
    }

    if (!RUNNERS[command]) {
      console.error(`[index] Unknown command: ${command}`);
      printHelp();
      process.exitCode = 1;
      return;
    }

    const code = await runRunner(command);
    process.exitCode = code;
  } catch (e) {
    console.error("[index] fatal error:", e?.message || e);
    process.exitCode = 1;
  }
})();