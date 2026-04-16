"use strict";

/** ****************************************************************************
 * platforms/thread/threadInternals.js
 *
 * 역할:
 *  - Threads 로그인 판정
 *  - 검색 URL 생성
 *  - 날짜 범위 파싱
 *  - 피드 게시글 수집
 *  - 댓글 모달 열기 / 입력 / 게시
 ******************************************************************************/

/** ****************************************************************************
 * 공통 sleep
 ******************************************************************************/
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/** ****************************************************************************
 * 로그인 도중 발생 가능한 일시적 navigation 에러 판정
 ******************************************************************************/
function isTransientContextError(error) {
    const msg = String(error?.message || error || "").toLowerCase();

    return (
        msg.includes("execution context was destroyed") ||
        msg.includes("cannot find context with specified id") ||
        msg.includes("frame was detached") ||
        msg.includes("navigating frame was detached") ||
        msg.includes("session closed") ||
        msg.includes("target closed")
    );
}

/** ****************************************************************************
 * 인증 진행 URL 판정
 ******************************************************************************/
function isThreadAuthUrl(url) {
    const value = String(url || "").toLowerCase();

    return (
        value.includes("/login") ||
        value.includes("/auth_platform/") ||
        value.includes("challenge") ||
        value.includes("checkpoint") ||
        value.includes("accountscenter") ||
        value.includes("accounts_center") ||
        value.includes("instagram.com/accounts")
    );
}

/** ****************************************************************************
 * 검색 URL 생성
 *
 * 기본:
 *  https://www.threads.com/search?q={검색어}&serp_type=default
 *
 * 최근:
 *  ...&filter=recent
 ******************************************************************************/
function buildThreadSearchUrl({ keyword, searchOption = "default" }) {
    const q = encodeURIComponent(String(keyword || "").trim());

    if (!q) {
        throw new Error("buildThreadSearchUrl: keyword is required");
    }

    let url = `https://www.threads.com/search?q=${q}&serp_type=default`;

    if (String(searchOption) === "recent") {
        url += "&filter=recent";
    }

    console.log(`[buildThreadSearchUrl] searchOption=${String(searchOption)}, typeof=${typeof searchOption}`);
    console.log(`[buildThreadSearchUrl] url=${url}`);

    return url;
}

/** ****************************************************************************
 * 날짜 범위 파싱
 * 형식: YYYY-MM-DD~YYYY-MM-DD
 ******************************************************************************/
function parseDateRange(range) {
    if (!range) {
        return {
            fromMs: null,
            toMs: null,
        };
    }

    const [fromRaw, toRaw] = String(range)
        .split("~")
        .map((value) => String(value || "").trim());

    const toStartMs = (value) => {
        if (!value) return null;
        const dt = new Date(`${value}T00:00:00.000`);
        return Number.isNaN(dt.getTime()) ? null : dt.getTime();
    };

    const toEndMs = (value) => {
        if (!value) return null;
        const dt = new Date(`${value}T23:59:59.999`);
        return Number.isNaN(dt.getTime()) ? null : dt.getTime();
    };

    return {
        fromMs: toStartMs(fromRaw),
        toMs: toEndMs(toRaw || fromRaw),
    };
}

/** ****************************************************************************
 * datetime 문자열이 날짜 범위 안인지 판정
 ******************************************************************************/
function isDateInRange(datetimeValue, range) {
    if (!datetimeValue) return false;

    const ts = new Date(datetimeValue).getTime();
    if (Number.isNaN(ts)) return false;

    if (range?.fromMs && ts < range.fromMs) return false;
    if (range?.toMs && ts > range.toMs) return false;

    return true;
}

/** ****************************************************************************
 * 로그인 여부 판정
 *
 * 중요:
 *  - 로그인 도중 auth_platform 이동은 정상
 *  - evaluate 실패 시 fatal 대신 soft-fail
 ******************************************************************************/
async function isThreadLoggedIn(page) {
    if (!page || page.isClosed()) {
        return {
            ok: false,
            reason: "NO_PAGE",
            transient: false,
        };
    }

    const currentUrl = page.url();

    /** --------------------------------------------------------------------------
     * 1) 인증 URL이면 로그인 진행 중
     * ----------------------------------------------------------------------- */
    if (isThreadAuthUrl(currentUrl)) {
        return {
            ok: false,
            reason: "AUTH_IN_PROGRESS",
            transient: true,
            url: currentUrl,
        };
    }

    /** --------------------------------------------------------------------------
     * 2) 홈/검색/프로필류 URL에서 UI 기반 판정
     * ----------------------------------------------------------------------- */
    try {
        const result = await page.evaluate(() => {
            const bodyText = String(document.body?.innerText || "");

            const hasLoginText =
                bodyText.includes("Log in") ||
                bodyText.includes("로그인");

            const loggedInSelectors = [
                "a[href='/']",
                "a[href='/search']",
                "svg[aria-label='홈']",
                "svg[aria-label='Home']",
                "[aria-label='새 스레드 작성']",
                "[aria-label='New thread']",
            ];

            const hasLoggedInUi = loggedInSelectors.some((sel) =>
                document.querySelector(sel),
            );

            return {
                hasLoginText,
                hasLoggedInUi,
            };
        });

        return {
            ok: Boolean(result?.hasLoggedInUi && !result?.hasLoginText),
            reason:
                result?.hasLoggedInUi && !result?.hasLoginText
                    ? "LOGGED_IN_UI"
                    : "NOT_CONFIRMED",
            transient: false,
            url: currentUrl,
        };
    } catch (error) {
        if (isTransientContextError(error)) {
            return {
                ok: false,
                reason: "NAVIGATION_IN_PROGRESS",
                transient: true,
                url: currentUrl,
            };
        }

        return {
            ok: false,
            reason: `EVAL_FAIL:${String(error?.message || error)}`,
            transient: false,
            url: currentUrl,
        };
    }
}

/** ****************************************************************************
 * 수동 로그인 대기
 *
 * 중요:
 *  - 여기서는 blank page 재생성 금지
 *  - transient navigation error는 무시하고 재시도
 ******************************************************************************/
async function waitForThreadLogin(
    page,
    {
        timeoutMs = 10 * 60 * 1000,
        intervalMs = 800,
        log = () => { },
    } = {},
) {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
        if (!page || page.isClosed()) {
            throw new Error("waitForThreadLogin: page closed");
        }

        const currentUrl = page.url();
        log(`[bot][thread.waitLogin] url=${currentUrl}`);

        let status;

        try {
            status = await isThreadLoggedIn(page);
        } catch (error) {
            if (isTransientContextError(error)) {
                log("[bot][thread.waitLogin] transient navigation error ignored");
                await sleep(intervalMs);
                continue;
            }
            throw error;
        }

        if (status.ok) {
            log("[bot][thread.waitLogin] login detected");
            return page;
        }

        await sleep(intervalMs);
    }

    throw new Error("THREAD_LOGIN_TIMEOUT");
}

/** ****************************************************************************
 * 텍스트 정규화
 ******************************************************************************/
function normalizeKeywordText(value) {
    return String(value || "")
        .normalize("NFKC")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
}

/** ****************************************************************************
 * 키워드 포함 여부
 *
 * 규칙:
 *  1) 전체 구문 포함이면 true
 *  2) 아니면 공백 기준 토큰을 모두 포함하면 true
 ******************************************************************************/
function doesTextMatchKeyword(text, keyword) {
    const normalizedText = normalizeKeywordText(text);
    const normalizedKeyword = normalizeKeywordText(keyword);

    if (!normalizedKeyword) return true;
    if (!normalizedText) return false;

    if (normalizedText.includes(normalizedKeyword)) {
        return true;
    }

    const tokens = normalizedKeyword.split(" ").filter(Boolean);
    if (tokens.length === 0) return true;

    return tokens.every((token) => normalizedText.includes(token));
}

/** ****************************************************************************
 * feed item 내부에서 본문 텍스트 추출
 *
 * 원칙:
 *  - class selector에 의존하지 않음
 *  - span 텍스트를 최대한 수집
 *  - 버튼/시간/액션 영역은 제외
 ******************************************************************************/
function extractThreadPostTextInBrowser(node) {
    const normalize = (value) =>
        String(value || "")
            .replace(/\s+/g, " ")
            .trim();

    const isExcluded = (el) => {
        if (!el) return true;

        if (el.closest("time")) return true;
        if (el.closest("button")) return true;
        if (el.closest("[role='button']")) return true;
        if (el.closest("svg")) return true;

        return false;
    };

    const spans = Array.from(node.querySelectorAll("span"));
    const lines = [];

    for (const span of spans) {
        if (isExcluded(span)) continue;

        const text = normalize(span.innerText || span.textContent || "");
        if (!text) continue;

        /** ------------------------------------------------------------
         * 너무 짧은 숫자/카운트성 텍스트 제거
         * ----------------------------------------------------------- */
        if (/^\d+$/.test(text)) continue;

        lines.push(text);
    }

    /** --------------------------------------------------------------------------
     * 중복 제거 후 join
     * ----------------------------------------------------------------------- */
    const uniqueLines = [];
    const seen = new Set();

    for (const line of lines) {
        if (seen.has(line)) continue;
        seen.add(line);
        uniqueLines.push(line);
    }

    return uniqueLines.join("\n");
}

/** ****************************************************************************
 * 현재 페이지의 feed item 수집
 *
 * 추가:
 *  - postText
 *  - matchesKeyword
 ******************************************************************************/
async function collectThreadFeedItems(page, { dateRange, keyword }) {
    const items = await page.evaluate(
        ({ range, searchKeyword }) => {
            const normalize = (value) =>
                String(value || "")
                    .normalize("NFKC")
                    .replace(/\s+/g, " ")
                    .trim()
                    .toLowerCase();

            const inRange = (datetimeValue) => {
                if (!datetimeValue) return false;

                const ts = new Date(datetimeValue).getTime();
                if (Number.isNaN(ts)) return false;

                if (range?.fromMs && ts < range.fromMs) return false;
                if (range?.toMs && ts > range.toMs) return false;

                return true;
            };

            const matchesKeyword = (text, keywordValue) => {
                const normalizedText = normalize(text);
                const normalizedKeyword = normalize(keywordValue);

                if (!normalizedKeyword) return true;
                if (!normalizedText) return false;

                if (normalizedText.includes(normalizedKeyword)) {
                    return true;
                }

                const tokens = normalizedKeyword.split(" ").filter(Boolean);
                if (tokens.length === 0) return true;

                return tokens.every((token) => normalizedText.includes(token));
            };

            const extractPostText = (node) => {
                const clean = (value) =>
                    String(value || "")
                        .replace(/\s+/g, " ")
                        .trim();

                const isExcluded = (el) => {
                    if (!el) return true;

                    if (el.closest("time")) return true;
                    if (el.closest("button")) return true;
                    if (el.closest("[role='button']")) return true;
                    if (el.closest("svg")) return true;

                    return false;
                };

                const spans = Array.from(node.querySelectorAll("span"));
                const lines = [];

                for (const span of spans) {
                    if (isExcluded(span)) continue;

                    const text = clean(span.innerText || span.textContent || "");
                    if (!text) continue;
                    if (/^\d+$/.test(text)) continue;

                    lines.push(text);
                }

                const uniqueLines = [];
                const seen = new Set();

                for (const line of lines) {
                    if (seen.has(line)) continue;
                    seen.add(line);
                    uniqueLines.push(line);
                }

                return uniqueLines.join("\n");
            };

            const feedNodes = Array.from(
                document.querySelectorAll("div[data-pagelet^='threads_search_results_']"),
            );

            return feedNodes.map((node, index) => {
                const timeEl = node.querySelector("time[datetime]");
                const datetime = timeEl?.getAttribute("datetime") || "";

                const anchors = Array.from(node.querySelectorAll("a[href]"));
                const postUrl =
                    anchors
                        .map((anchor) => anchor.href)
                        .find((href) => /\/post\//i.test(href)) || "";

                const replySvg =
                    node.querySelector("svg[aria-label='답글']") ||
                    node.querySelector("svg[aria-label='Reply']");

                const postText = extractPostText(node);

                return {
                    index,
                    pagelet: node.getAttribute("data-pagelet") || "",
                    datetime,
                    postUrl,
                    hasReplyButton: Boolean(replySvg),
                    postText,
                    inRange: inRange(datetime),
                    matchesKeyword: matchesKeyword(postText, searchKeyword),
                };
            });
        },
        {
            range: dateRange,
            searchKeyword: keyword,
        },
    );

    return Array.isArray(items) ? items : [];
}

/** ****************************************************************************
 * 게시글 카드에서 답글 버튼 클릭
 *
 * 기준:
 *  - svg[aria-label="답글"] 찾기
 *  - 4번 상위 div 이동
 *  - role="button" 클릭
 ******************************************************************************/
async function openReplyModalFromFeed(page, postUrl) {
    const clicked = await page.evaluate((targetUrl) => {
        const nodes = Array.from(
            document.querySelectorAll("div[data-pagelet^='threads_search_results_']"),
        );

        const findPostUrl = (node) => {
            const anchors = Array.from(node.querySelectorAll("a[href]"));
            return (
                anchors
                    .map((anchor) => anchor.href)
                    .find((href) => /\/post\//i.test(href)) || ""
            );
        };

        for (const node of nodes) {
            const currentPostUrl = findPostUrl(node);
            if (!currentPostUrl || currentPostUrl !== targetUrl) continue;

            const svg =
                node.querySelector("svg[aria-label='답글']") ||
                node.querySelector("svg[aria-label='Reply']");

            if (!svg) return false;

            const button =
                svg.closest?.("div[role='button'], [role='button']") ||
                svg.parentElement?.closest?.("div[role='button'], [role='button']");

            if (!button) continue;

            button.scrollIntoView({
                block: "center",
                inline: "center",
                behavior: "instant",
            });

            button.click();
            return true;
        }

        return false;
    }, postUrl);

    if (!clicked) {
        throw new Error("THREAD_REPLY_BUTTON_NOT_FOUND");
    }
}

/** ****************************************************************************
 * 댓글 모달 editor 대기
 ******************************************************************************/
async function waitForReplyEditor(page, timeoutMs = 15000) {
    const selectors = [
        "[role='dialog'] [role='textbox']",
        "[role='dialog'] [contenteditable='true']",
        "[role='dialog'] textarea",
    ];

    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
        for (const selector of selectors) {
            const exists = await page.evaluate((sel) => {
                return Boolean(document.querySelector(sel));
            }, selector);

            if (exists) {
                return selector;
            }
        }

        await sleep(200);
    }

    throw new Error("THREAD_REPLY_EDITOR_NOT_FOUND");
}

/** ****************************************************************************
 * 댓글 입력
 ******************************************************************************/
async function typeReplyText(page, commentText) {
    const selector = await waitForReplyEditor(page);

    await page.click(selector, { delay: 30 }).catch(() => { });
    await sleep(120);

    /** --------------------------------------------------------------------------
     * 기존 텍스트 선택 후 삭제
     * ----------------------------------------------------------------------- */
    await page.keyboard.down("Control");
    await page.keyboard.press("KeyA");
    await page.keyboard.up("Control");
    await page.keyboard.press("Backspace");
    await sleep(60);

    /** --------------------------------------------------------------------------
     * 댓글 입력
     * ----------------------------------------------------------------------- */
    await page.keyboard.type(String(commentText || ""), { delay: 12 });
    await sleep(150);
}

/** ****************************************************************************
 * 댓글 게시 버튼 클릭
 *
 * 기준:
 *  - 모달 내부에서 '게시' 텍스트를 가진 노드 탐색
 *  - 상위 role=button 클릭
 ******************************************************************************/
async function submitReply(page) {
    const clicked = await page.evaluate(() => {
        const dialog = document.querySelector("[role='dialog']");
        if (!dialog) return false;

        const all = Array.from(dialog.querySelectorAll("*"));

        for (const node of all) {
            const text = String(node.textContent || "").trim();
            if (text !== "게시" && text.toLowerCase() !== "post") {
                continue;
            }

            const button =
                node.getAttribute?.("role") === "button"
                    ? node
                    : node.closest?.("[role='button'], button");

            if (!button) continue;

            button.scrollIntoView({
                block: "center",
                inline: "center",
                behavior: "instant",
            });

            button.click();
            return true;
        }

        return false;
    });

    if (!clicked) {
        throw new Error("THREAD_REPLY_SUBMIT_BUTTON_NOT_FOUND");
    }

    await sleep(1200);
}

/** ****************************************************************************
 * 한 feed item에 댓글 작성
 ******************************************************************************/
async function commentOnThreadFeedItem(page, { postUrl, commentText }) {
    if (!postUrl) {
        throw new Error("commentOnThreadFeedItem: postUrl is required");
    }

    if (!commentText) {
        throw new Error("commentOnThreadFeedItem: commentText is required");
    }

    await openReplyModalFromFeed(page, postUrl);
    await sleep(500);

    await typeReplyText(page, commentText);
    await submitReply(page);

    return true;
}

/** ****************************************************************************
 * 스크롤
 ******************************************************************************/
async function scrollThreadFeed(page, step = 1400) {
    await page.evaluate((dy) => {
        window.scrollBy(0, dy);
    }, step);

    await sleep(900);
}

module.exports = {
    sleep,
    isTransientContextError,
    isThreadAuthUrl,
    buildThreadSearchUrl,
    parseDateRange,
    isDateInRange,
    isThreadLoggedIn,
    waitForThreadLogin,
    collectThreadFeedItems,
    commentOnThreadFeedItem,
    scrollThreadFeed,
};