/**
 * renderer/app.js
 *
 * =============================================================================
 * ELECTRON RENDERER UI
 * =============================================================================
 *
 * 역할:
 *  1) 초기 bot 상태 목록 로드
 *  2) 카드 UI 렌더링
 *  3) Start / Stop 버튼 이벤트 연결
 *  4) status / log 이벤트 실시간 반영
 *  5) 로그 필터 / 로그 초기화 지원
 * =============================================================================
 */

/** ****************************************************************************
 * 전역 상태
 ******************************************************************************/
const state = {
  bots: {},
  logs: [],
  logFilter: "all",

  /** browser 옵션 */
  launchOptions: {
    headless: false,
  },

  /** bot 실행 설정 */
  config: {
    target: "reddit",
    reddit: {
      dateRange: "",
      subreddit: "",
      keyword: "",
      commentCount: 1,
      commentText: "",
    },
  },
};

/** ****************************************************************************
 * DOM 참조
 ******************************************************************************/
const botGridEl = document.getElementById("bot-grid");
const logViewEl = document.getElementById("log-view");
const refreshBtnEl = document.getElementById("refresh-btn");
const clearLogBtnEl = document.getElementById("clear-log-btn");
const historyBtnEl = document.getElementById("history-btn");
const logFilterEl = document.getElementById("log-filter");
const browserOptionsEl = document.getElementById("browser-options");
const botConfigEl = document.getElementById("bot-config");
const historyPanelEl = document.getElementById("history-panel");
const historyListEl = document.getElementById("history-list");
const historyBackBtnEl = document.getElementById("history-back-btn");


/**
 * browser 옵션 토글 렌더링
 */
function renderHeadlessToggle() {
  browserOptionsEl.innerHTML = `
    <label class="toggle">
      <input type="checkbox" id="headless-toggle" ${state.launchOptions.headless ? "checked" : ""
    }>
      창 없이 실행
    </label>
  `;

  document
    .getElementById("headless-toggle")
    .addEventListener("change", (e) => {
      state.launchOptions.headless = e.target.checked;
    });
}

/** ****************************************************************************
 * bot 실행 설정
 ******************************************************************************/
function renderBotConfig() {
  botConfigEl.innerHTML = `
    <div class="bot-config-row">
      <label for="target-select">적용 대상</label>
      <select id="target-select" class="select">
        <option value="reddit" ${state.config.target === "reddit" ? "selected" : ""}>Reddit</option>
        <option value="instagram" ${state.config.target === "instagram" ? "selected" : ""}>Instagram</option>
        <option value="dc" ${state.config.target === "dc" ? "selected" : ""}>DCInside</option>
      </select>
    </div>

    <div id="reddit-config" class="${state.config.target !== "reddit" ? "hidden" : ""}">
      <div class="bot-config-row">
        <label for="reddit-date-range">날짜 범위 (YYYY-MM-DD~YYYY-MM-DD)</label>
        <input id="reddit-date-range" placeholder="2026-03-01~2026-03-10" value="${escapeHtml(
          state.config.reddit.dateRange,
        )}" />
      </div>

      <div class="bot-config-row">
        <label for="reddit-subreddit">커뮤니티 (subreddit)</label>
        <input id="reddit-subreddit" placeholder="javascript" value="${escapeHtml(
          state.config.reddit.subreddit,
        )}" />
      </div>

      <div class="bot-config-row">
        <label for="reddit-keyword">키워드 (제목 포함)</label>
        <input id="reddit-keyword" placeholder="automation" value="${escapeHtml(
          state.config.reddit.keyword,
        )}" />
      </div>

      <div class="bot-config-row">
        <label for="reddit-comment-count">댓글 개수</label>
        <input id="reddit-comment-count" type="number" min="1" value="${state.config.reddit.commentCount}" />
      </div>

      <div class="bot-config-row">
        <label for="reddit-comment-text">댓글 내용</label>
        <textarea id="reddit-comment-text" placeholder="댓글 텍스트...">${escapeHtml(
          state.config.reddit.commentText,
        )}</textarea>
      </div>
    </div>
  `;
}

function updateBotConfigUI() {
  const targetSelect = document.getElementById("target-select");
  const redditConfig = document.getElementById("reddit-config");

  if (targetSelect) {
    targetSelect.value = state.config.target;
  }

  if (redditConfig) {
    redditConfig.classList.toggle("hidden", state.config.target !== "reddit");

    const dateRange = document.getElementById("reddit-date-range");
    const subreddit = document.getElementById("reddit-subreddit");
    const keyword = document.getElementById("reddit-keyword");
    const commentCount = document.getElementById("reddit-comment-count");
    const commentText = document.getElementById("reddit-comment-text");

    if (dateRange) dateRange.value = state.config.reddit.dateRange;
    if (subreddit) subreddit.value = state.config.reddit.subreddit;
    if (keyword) keyword.value = state.config.reddit.keyword;
    if (commentCount) commentCount.value = state.config.reddit.commentCount;
    if (commentText) commentText.value = state.config.reddit.commentText;
  }
}

function handleBotConfigInput(event) {
  const { id, value } = event.target;

  if (id === "target-select") {
    state.config.target = value;
    renderBots();
    updateBotConfigUI();
    return;
  }

  if (id === "reddit-date-range") {
    state.config.reddit.dateRange = value;
    return;
  }

  if (id === "reddit-subreddit") {
    state.config.reddit.subreddit = value;
    return;
  }

  if (id === "reddit-keyword") {
    state.config.reddit.keyword = value;
    return;
  }

  if (id === "reddit-comment-count") {
    const num = Number(value);
    state.config.reddit.commentCount = Number.isNaN(num) ? 0 : num;
    return;
  }

  if (id === "reddit-comment-text") {
    state.config.reddit.commentText = value;
    return;
  }
}

/** ****************************************************************************
 * 상태 badge class
 ******************************************************************************/
function getBadgeClass(status) {
  if (status === "running") return "badge badge-running";
  if (status === "stopped") return "badge badge-stopped";
  if (status === "error") return "badge badge-error";
  return "badge badge-idle";
}

/** ****************************************************************************
 * bot 카드 렌더링
 ******************************************************************************/
function renderBots() {
  const bots = Object.values(state.bots);

  botGridEl.innerHTML = bots
    .map((bot) => {
      const isRunning = bot.status === "running";
      const isSelected = bot.key === state.config.target;
      const startDisabled = isRunning || !isSelected;

      return `
        <div class="bot-card">
          <div class="bot-card-top">
            <div class="bot-title">${bot.label}</div>
            <div class="${getBadgeClass(bot.status)}">${bot.status}</div>
          </div>

          <div class="bot-meta">
            <div><strong>key:</strong> ${bot.key}</div>
            <div><strong>pid:</strong> ${bot.pid ?? "-"}</div>
            <div><strong>startedAt:</strong> ${bot.startedAt ?? "-"}</div>
            <div><strong>exitCode:</strong> ${bot.exitCode ?? "-"}</div>
            <div><strong>lastError:</strong> ${bot.lastError || "-"}</div>
          </div>

          <div class="bot-actions">
            <button
              class="btn"
              data-action="start"
              data-key="${bot.key}"
              ${startDisabled ? "disabled" : ""}
            >
              Start
            </button>

            <button
              class="btn btn-danger"
              data-action="stop"
              data-key="${bot.key}"
              ${!isRunning ? "disabled" : ""}
            >
              Stop
            </button>
          </div>
        </div>
      `;
    })
    .join("");
}

/** ****************************************************************************
 * 로그 HTML escape
 ******************************************************************************/
function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/** ****************************************************************************
 * 로그 렌더링
 ******************************************************************************/
function renderLogs() {
  const visibleLogs =
    state.logFilter === "all"
      ? state.logs
      : state.logs.filter((log) => log.key === state.logFilter);

  logViewEl.innerHTML = visibleLogs
    .map((log) => {
      const levelClass =
        log.level === "error"
          ? "lvl-error"
          : log.level === "system"
            ? "lvl-system"
            : "lvl-info";

      return `
        <div class="log-line">
          <span class="ts">[${escapeHtml(log.ts)}]</span>
          <span class="key">[${escapeHtml(log.key)}]</span>
          <span class="${levelClass}">${escapeHtml(log.message)}</span>
        </div>
      `;
    })
    .join("");

  logViewEl.scrollTop = logViewEl.scrollHeight;
}

/** ****************************************************************************
 * bot 상태 목록 새로 로드
 ******************************************************************************/
async function refreshBots() {
  const list = await window.botAPI.listBots();

  state.bots = Object.fromEntries(
    list.map((bot) => [bot.key, bot]),
  );

  renderBots();
}

/** ****************************************************************************
 * 버튼 이벤트 위임
 ******************************************************************************/
async function handleBotActionClick(event) {
  const button = event.target.closest("button[data-action]");
  if (!button) return;

  const { action, key } = button.dataset;
  if (!action || !key) return;

  if (action === "start") {
    if (key === "reddit") {
      const cfg = state.config.reddit;
      if (!cfg.subreddit || !cfg.keyword || !cfg.commentText || cfg.commentCount <= 0) {
        state.logs.push({
          key: "reddit",
          level: "error",
          message:
            "Reddit 설정이 불완전합니다. 커뮤니티, 키워드, 댓글 개수, 댓글 내용을 모두 입력해 주세요.",
          ts: new Date().toISOString(),
        });
        renderLogs();
        return;
      }
    }

    const options = {
      headless: state.launchOptions.headless,
    };

    if (key === "reddit") {
      options.redditConfig = { ...state.config.reddit };
    }

    const res = await window.botAPI.startBot(
      key,
      options,
    );

    if (!res?.ok) {
      state.logs.push({
        key,
        level: "error",
        message: `[renderer] start failed: ${res?.error || "unknown error"}`,
        ts: new Date().toISOString(),
      });

      renderLogs();
    }

    return;
  }

  if (action === "stop") {
    const res = await window.botAPI.stopBot(key);
    if (!res?.ok) {
      state.logs.push({
        key,
        level: "error",
        message: `[renderer] stop failed: ${res?.error || "unknown error"}`,
        ts: new Date().toISOString(),
      });
      renderLogs();
    }
  }
}

/** ****************************************************************************
 * 초기화
 *
 * 단계:
 *  1) 초기 bot 목록 조회
 *  2) 렌더링
 *  3) 버튼/필터 이벤트 연결
 *  4) status 이벤트 반영
 *  5) log 이벤트 반영
 ******************************************************************************/
async function loadHistory() {
  const history = await window.botAPI.getHistory();
  renderHistory(history);
}

function renderHistory(history = []) {
  historyListEl.innerHTML = history
    .slice()
    .reverse()
    .map((item) => {
      const time = new Date(item.createdAt || item.ts || Date.now()).toLocaleString();
      const target = item.target || "unknown";
      const config = item.config || {};
      const urls = Array.isArray(item.urls) ? item.urls : [];

      const meta = [];
      if (config.subreddit) meta.push(`subreddit: ${escapeHtml(config.subreddit)}`);
      if (config.keyword) meta.push(`keyword: ${escapeHtml(config.keyword)}`);
      if (config.dateRange) meta.push(`dateRange: ${escapeHtml(config.dateRange)}`);
      if (typeof config.count !== "undefined") meta.push(`count: ${escapeHtml(String(config.count))}`);

      return `
        <div class="history-card">
          <h3>${escapeHtml(target)} - ${escapeHtml(time)}</h3>
          <div class="meta">
            <div>조건: ${meta.length ? meta.join(" / ") : "-"}</div>
            <div>댓글 내용: ${escapeHtml(config.commentText || "(없음)")}</div>
          </div>
          <div>
            <div style="font-weight:700; margin-bottom:6px;">댓글 단 URL</div>
            <ul class="urls">
              ${urls.length
                ? urls.map((u) => `<li><a href="${escapeHtml(u)}" target="_blank">${escapeHtml(u)}</a></li>`).join("")
                : "<li>(없음)</li>"}
            </ul>
          </div>
        </div>
      `;
    })
    .join("");
}

function showHistory() {
  botGridEl.closest(".panel").classList.add("hidden");
  historyPanelEl.classList.remove("hidden");
  loadHistory();
}

function hideHistory() {
  historyPanelEl.classList.add("hidden");
  botGridEl.closest(".panel").classList.remove("hidden");
}

async function init() {
  await refreshBots();
  renderLogs();
  renderHeadlessToggle();
  renderBotConfig();
  updateBotConfigUI();

  botConfigEl.addEventListener("input", handleBotConfigInput);
  botConfigEl.addEventListener("change", handleBotConfigInput);

  botGridEl.addEventListener("click", handleBotActionClick);
  historyBtnEl.addEventListener("click", showHistory);
  historyBackBtnEl.addEventListener("click", hideHistory);

  refreshBtnEl.addEventListener("click", async () => {
    await refreshBots();
  });

  clearLogBtnEl.addEventListener("click", () => {
    state.logs = [];
    renderLogs();
  });

  logFilterEl.addEventListener("change", () => {
    state.logFilter = logFilterEl.value;
    renderLogs();
  });

  window.botAPI.onStatus((payload) => {
    state.bots[payload.key] = payload;
    renderBots();
  });

  window.botAPI.onLog((payload) => {
    state.logs.push(payload);

    /** 로그 무한 증가 방지 */
    if (state.logs.length > 3000) {
      state.logs = state.logs.slice(-2000);
    }

    renderLogs();
  });
}

init().catch((err) => {
  state.logs.push({
    key: "ui",
    level: "error",
    message: `[renderer] init failed: ${err?.message || err}`,
    ts: new Date().toISOString(),
  });
  renderLogs();
});