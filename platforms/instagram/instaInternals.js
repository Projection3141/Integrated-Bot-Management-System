/**
 * platforms/instagram/instaInternals.js
 *
 * =============================================================================
 * Instagram 내부 함수
 * =============================================================================
 *
 * 역할:
 *  - Create 아이콘 클릭
 *  - role=button div 텍스트 클릭
 *  - file input 업로드
 *  - Lexical caption editor 입력
 *
 * 주의:
 *  - 외부에서는 instaBot.js를 통해서만 사용한다.
 * =============================================================================
 */

const { sleep, assertReadableFile } = require("../../core/helpers");
const { gotoUrlSafe, clickInFrame } = require("../../core/navigation");

/** ****************************************************************************
 * selector 대기
 ******************************************************************************/
async function waitForSelectorOrThrow(page, selector, timeout = 20000) {
  await page.waitForSelector(selector, { timeout });
  return selector;
}

/** ****************************************************************************
 * div[role=button] 중 텍스트로 클릭
 ******************************************************************************/
async function clickRoleButtonDivByText(page, text, timeout = 20000) {
  const target = String(text || "").trim();
  if (!target) throw new Error("clickRoleButtonDivByText: text is required");

  const start = Date.now();

  while (Date.now() - start < timeout) {
    const handles = await page.$$('div[role="button"]');
    for (const handle of handles) {
      const label = String(
        await page.evaluate((el) => (el.textContent || "").trim(), handle)
      ).trim();
      if (label === target) {
        await handle.click();
        if (typeof handle.dispose === "function") await handle.dispose();
        return true;
      }
      if (typeof handle.dispose === "function") await handle.dispose();
    }
    await sleep(250);
  }

  throw new Error(`clickRoleButtonDivByText timeout: "${target}"`);
}

/** ****************************************************************************
 * Create 아이콘 클릭
 *
 * 우선순위:
 *  1) svg[aria-label="Create"]
 *  2) svg[aria-label="New post"]
 *  3) 텍스트 create / new post / 만들기 / 새 게시물
 ******************************************************************************/
async function clickCreateByIcon(page, timeout = 30000) {
  const start = Date.now();
  const texts = ["create", "new post", "만들기", "새 게시물"];

  while (Date.now() - start < timeout) {
    const svgHandle = await page.$('svg[aria-label="Create"], svg[aria-label="New post"]');
    if (svgHandle) {
      const clickableHandle = await page.evaluateHandle(
        (el) => el.closest('a[role="link"], button, div[role="button"]') || el,
        svgHandle
      );
      const clickableEl = clickableHandle.asElement();
      if (clickableEl) {
        await clickableEl.click();
        if (typeof clickableEl.dispose === "function") await clickableEl.dispose();
        if (typeof svgHandle.dispose === "function") await svgHandle.dispose();
        return true;
      }
      if (typeof clickableHandle.dispose === "function") await clickableHandle.dispose();
      if (typeof svgHandle.dispose === "function") await svgHandle.dispose();
    }

    const handles = await page.$$('a[role="link"], div[role="button"], button');
    for (const handle of handles) {
      const text = String(
        await page.evaluate((el) => (el.textContent || "").trim().toLowerCase(), handle)
      ).trim();
      if (texts.some((key) => text === key || text.includes(key))) {
        await handle.click();
        if (typeof handle.dispose === "function") await handle.dispose();
        return true;
      }
      if (typeof handle.dispose === "function") await handle.dispose();
    }

    await sleep(250);
  }

  throw new Error("clickCreateByIcon timeout: Create icon not found");
}

/** ****************************************************************************
 * file input 업로드
 ******************************************************************************/
async function uploadImageFile(page, imagePath, timeout = 30000) {
  const absPath = await assertReadableFile(imagePath);

  await waitForSelectorOrThrow(page, 'input[type="file"]', timeout);
  const input = await page.waitForSelector('input[type="file"]', { timeout });
  if (!input) throw new Error("uploadImageFile: file input handle not found");

  await input.uploadFile(absPath);
  if (typeof input.dispose === "function") {
    await input.dispose();
  }

  await sleep(900);

  return absPath;
}

/** ****************************************************************************
 * Lexical caption 입력
 *
 * 단계:
 *  1) editor 대기
 *  2) 클릭/포커스
 *  3) Ctrl+A / Backspace
 *  4) keyboard.type
 *  5) span[data-lexical-text=true] 검증
 *  6) 실패 시 paste 이벤트 fallback
 ******************************************************************************/
async function typeCaptionLexical(page, caption) {
  const editorSel =
    'div[role="textbox"][aria-placeholder="문구를 입력하세요..."][data-lexical-editor="true"]';

  await page.waitForSelector(editorSel, { timeout: 30000 });
  await clickInFrame(page, editorSel, { timeout: 30000, tag: "typeCaptionFocus" });
  await page.focus(editorSel);

  await page.keyboard.down("Control");
  await page.keyboard.press("KeyA");
  await page.keyboard.up("Control");
  await page.keyboard.press("Backspace");

  await page.keyboard.type(String(caption || ""), { delay: 15 });

  const ok = await page
    .waitForFunction(
      (sel, expected) => {
        const root = document.querySelector(sel);
        if (!root) return false;

        const span = root.querySelector('span[data-lexical-text="true"]');
        const got = (span?.textContent || "").trim();
        return got.includes(String(expected || "").trim());
      },
      { timeout: 6000 },
      editorSel,
      caption
    )
    .then(() => true)
    .catch(() => false);

  if (ok) return true;

  await safeEvaluate(page, (sel, text) => {
    const el = document.querySelector(sel);
    if (!el) return;

    el.scrollIntoView({ block: "center", inline: "center" });
    el.click();
    el.focus?.();

    const dt = new DataTransfer();
    dt.setData("text/plain", String(text || ""));

    const evt = new ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
      clipboardData: dt,
    });

    el.dispatchEvent(evt);
  }, editorSel, caption);

  await page.waitForFunction(
    (sel, expected) => {
      const root = document.querySelector(sel);
      if (!root) return false;

      const span = root.querySelector('span[data-lexical-text="true"]');
      const got = (span?.textContent || "").trim();
      return got.includes(String(expected || "").trim());
    },
    { timeout: 8000 },
    editorSel,
    caption
  );

  return true;
}

module.exports = {
  waitForSelectorOrThrow,
  clickRoleButtonDivByText,
  clickCreateByIcon,
  uploadImageFile,
  typeCaptionLexical,
};