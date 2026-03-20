# Debug Log

## 1) 문제 요약

### ✅ 1) Headless 체크해제해도 브라우저가 뜨지 않음
- UI에서 `headless` 토글을 끄고 실행해도 브라우저 창이 보이지 않음.
- 로그에는 `entered site`가 찍히고, 봇이 정상 종료(`code=0`)됨.

### ✅ 2) `[bot][reddit.page] framedetached` 메시지가 반복되고, 곧바로 `closed (code=0)` 후 `stopped` 상태
- Reddit 자동화 중 `framedetached` 이벤트가 계속 찍히고, 봇이 빠르게 종료됨.

---

## 2) 원인 분석

### 2.1 BrowserEngine `headless` 옵션이 항상 `true`로 고정되어 있음
- `core/browserEngine.js`에서 `puppeteerExtra.launch({ headless: true, ... })`로 되어 있음.
- 따라서 UI에서 `headless:false`로 변경해도 Puppeteer는 항상 헤드리스 모드로 실행됨.

### 2.2 Reddit runner에서 `BOT_HEADLESS` 해석이 반대였음
- `platforms/reddit/runReddit.js`에서 `BOT_HEADLESS === "0"`일 때 `headless`로 설정함.
- Electron UI에서는 체크 해제 상태에서 `BOT_HEADLESS: "0"`을 전달하기 때문에, 실제로는 창 있어야 하는 상황이 무시됨.

### 2.3 `framedetached` 로그는 보통 SPA/동적 페이지에서 발생하는 정상 현상
- Puppeteer가 페이지 프레임이 변경될 때(리디렉션, 라우팅, DOM 변경 등) `framedetached` 이벤트를 던짐.
- 레딧 UI는 동적이므로, 이 이벤트가 자주 발생할 수 있음.

### 2.4 `closed (code=0)` / `stopped` 상태는 정상 종료를 의미
- `platforms/reddit/runReddit.js`에서 마지막에 `sleep(10000)` 후 `closeAll()` 호출함.
- 즉, 10초 후 스크립트가 곧바로 종료되기 때문에 `code=0`이 찍히고 `stopped` 됨.

---

## 3) 수정 내용 (2026-03-19)

### 3.1 수정 1: `core/browserEngine.js` headless 옵션 반영
- 수정 파일: `core/browserEngine.js`
- 변경 사항: `puppeteerExtra.launch({ headless, ... })` (기존 `headless: true`)

### 3.2 수정 2: `runReddit.js`에서 `BOT_HEADLESS` 처리 정상화
- 수정 파일: `platforms/reddit/runReddit.js`
- 변경 사항: `const HEADLESS = process.env.BOT_HEADLESS === "1";` (기존 `=== "0"`)

### 3.3 수정 3: 실행 이력 저장 및 UI 조회 기능 추가
- 수정 파일: `main.js`, `preload.js`, `renderer/app.js`, `renderer/index.html`, `platforms/reddit/runReddit.js`
- 변경 사항:
  - **실행 이력 저장**
    - 파일: `history/history.log`
    - 형식: JSON 한 줄(라인) 단위
    - 저장 내용: 실행일시(`createdAt`), 대상(`target`), 실행 조건(`config`), 댓글 단 URL 목록(`urls`)
  - **UI 개선**
    - 사이드바에 **실행 이력 확인** 버튼 추가
    - 메인 화면에 이력 패널 추가 (대상별, 실행일시, 조건, 댓글 URL 목록)
  - **IPC 추가**
    - 새로운 IPC 채널 `bot:getHistory` 추가
    - `preload.js`에서 `botAPI.getHistory()`로 노출

---

### 3.4 추가: 이력 저장 대상 범위
- 현재는 **Reddit bot 동작 시에만** 이력이 기록됩니다.
- 다른 플랫폼(bot)도 동일 방식으로 기록을 추가하려면
  - 각 `run*.js`에 `appendHistory()` 호출을 추가하거나
  - `main.js`에서 종료 시점에 추가 기록하도록 확장해야 합니다.

---

## 4) 향후 개선/추가 확인 사항 (To Do)

### 🔧 1) 브라우저가 보여지는지 시각적 확인 테스트
- UI에서 headless 토글 켜고 끌 때 브라우저 창이 실제로 보이고 숨겨지는지 확인.

### 🔧 2) `framedetached` 로그의 원인 더 정확히 추적
- `core/navigation.js` 및 `core/browserEngine.js`에서 `page.on("framedetached")` 로그를 빈도/내용 제한.
- 필요 시, `framedetached`가 많을 경우 재시도 로직 강화 (현재는 `withRetry`에서 이미 처리).

### 🔧 3) Reddit Runner 종료 조건 개선
- 현재는 `sleep(10000)` 후 종료. 실사용에서는 명시적 종료 흐름이 필요할 수 있음.
- 예: 특정 동작 완료 시 종료, UI에서 `stop` 클릭 시 바로 종료.

---

## 5) 참고
- `framedetached`는 Puppeteer 이벤트이므로, **오류가 아닌 상태 로그**임.
- `code=0`은 **정상 종료(에러 없음)** 를 의미하며, `stopped` 상태 역시 `main.js`에서 정상 종료로 분류됨.
