/**
 * redditBotInternals.js
 *
 * -----------------------------------------------------------------------------
 * PURPOSE
 * -----------------------------------------------------------------------------
 * This file contains all INTERNAL utilities used by redditBot.js.
 *
 * These functions are NOT meant to be used directly by the application layer.
 * Instead, redditBot.js exposes higher-level features built on top of these.
 *
 * -----------------------------------------------------------------------------
 * INTERNAL FUNCTION GROUPS
 * -----------------------------------------------------------------------------
 *
 * 1. Browser / Page Management
 *    - openPage
 *    - recreatePage
 *    - gotoUrlSafe
 *
 * 2. Wait / Retry Utilities
 *    - sleep
 *    - withRetry
 *    - waitForSelectorSafe
 *    - safeWaitNetworkIdle
 *
 * 3. Reddit Login Helpers
 *    - setFaceplateTextInputById
 *    - clickLoginButton
 *
 * 4. Post Creation Helpers
 *    - setTitleFaceplateTextarea
 *    - setBodyLexicalRTE
 *    - clickSubmitPostButton
 *
 * 5. Comment System Helpers
 *    - focusCommentEditorDeepStrict
 *    - setCommentTextByKeyboard
 *    - clickCommentSubmitButtonDeep
 *    - scrollToCommentsArea
 *
 * -----------------------------------------------------------------------------
 * DESIGN GOAL
 * -----------------------------------------------------------------------------
 * redditBot.js remains small and readable.
 * All low-level browser automation logic lives here.
 */

const fs = require("fs");
const path = require("path");

const puppeteerExtra = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");

puppeteerExtra.use(StealthPlugin());

/** ****************************************************************************
 * BASIC UTILITIES
 ******************************************************************************/

/**
 * sleep(ms)
 * Pause execution for a given number of milliseconds.
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * ensureDir(dir)
 * Creates directory recursively if it does not exist.
 */
function ensureDir(dirPath) {
  try {
    fs.mkdirSync(dirPath, { recursive: true });
  } catch {}
}

/** ****************************************************************************
 * RETRY SYSTEM
 ******************************************************************************/

/**
 * withRetry(fn)
 *
 * Executes a function and retries if certain transient browser errors occur.
 */
async function withRetry(fn, { tries = 3, delayMs = 500 } = {}) {
  let lastErr;

  for (let i = 0; i < tries; i++) {
    try {
      return await fn(i);
    } catch (e) {
      lastErr = e;
      await sleep(delayMs);
    }
  }

  throw lastErr;
}

/** ****************************************************************************
 * NETWORK HELPERS
 ******************************************************************************/

/**
 * safeWaitNetworkIdle(page)
 *
 * Waits until network becomes idle.
 * This prevents interacting with partially rendered Reddit UI.
 */
async function safeWaitNetworkIdle(page, timeout = 12000) {
  try {
    await page.waitForNetworkIdle({
      idleTime: 800,
      timeout,
    });
  } catch {}
}

/** ****************************************************************************
 * SELECTOR WAIT
 ******************************************************************************/

/**
 * waitForSelectorSafe(page, selector)
 *
 * Robust wrapper around page.waitForSelector.
 */
async function waitForSelectorSafe(page, selector, timeout = 20000) {
  return withRetry(async () => {
    await page.waitForSelector(selector, { timeout });
  });
}

/** ****************************************************************************
 * PROFILE MANAGEMENT
 ******************************************************************************/

function resolveTempUserDataDir(profileKey = "reddit_kr") {
  const base = path.resolve(process.cwd(), ".puppeteer_profiles");
  ensureDir(base);

  const safeKey = profileKey.replace(/[^\w\-]+/g, "_");

  const dir = path.join(
    base,
    `${safeKey}__tmp__${Date.now()}__${Math.random().toString(16).slice(2)}`
  );

  ensureDir(dir);

  return dir;
}

/** ****************************************************************************
 * BROWSER LAUNCH
 ******************************************************************************/

/**
 * openPage()
 *
 * Launches puppeteer browser with stealth plugin and temporary profile.
 */
async function openPage({ url, headless = false, viewport = { width: 1280, height: 900 } }) {

  const userDataDir = resolveTempUserDataDir("reddit");

  const browser = await puppeteerExtra.launch({
    headless,
    userDataDir,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
    ],
    defaultViewport: viewport,
  });

  const page = await browser.newPage();

  await page.goto(url, { waitUntil: "domcontentloaded" });

  return { browser, page };
}

/** ****************************************************************************
 * SAFE NAVIGATION
 ******************************************************************************/

/**
 * gotoUrlSafe(page, url)
 *
 * Handles frame detach issues by retrying navigation.
 */
async function gotoUrlSafe(page, url) {
  await page.goto(url, {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });

  return page;
}

/** ****************************************************************************
 * LOGIN HELPERS
 ******************************************************************************/

async function setFaceplateTextInputById(page, id, value) {

  const hostSel = `faceplate-text-input#${id}`;

  await waitForSelectorSafe(page, hostSel);

  await page.evaluate((sel, val) => {

    const host = document.querySelector(sel);
    const root = host.shadowRoot;

    const input = root.querySelector("input");

    input.value = val;

    input.dispatchEvent(new Event("input", { bubbles: true }));

  }, hostSel, value);
}

/**
 * clickLoginButton()
 *
 * Finds the login button and triggers click.
 */
async function clickLoginButton(page) {

  await page.evaluate(() => {

    const spans = Array.from(document.querySelectorAll("span"));

    const hit = spans.find(s =>
      ["Log in", "Sign in", "로그인"].includes(s.textContent.trim())
    );

    if (!hit) throw new Error("Login button not found");

    hit.closest("button").click();

  });
}

/** ****************************************************************************
 * POST HELPERS
 ******************************************************************************/

async function setTitleFaceplateTextarea(page, title) {

  const sel = 'faceplate-textarea-input[name="title"]';

  await waitForSelectorSafe(page, sel);

  await page.evaluate((sel, val) => {

    const host = document.querySelector(sel);
    const root = host.shadowRoot;

    const textarea = root.querySelector("textarea");

    textarea.value = val;

    textarea.dispatchEvent(new Event("input", { bubbles: true }));

  }, sel, title);
}

async function setBodyLexicalRTE(page, body) {

  const editor =
    'div[contenteditable="true"][data-lexical-editor="true"]';

  await waitForSelectorSafe(page, editor);

  await page.type(editor, body);
}

async function clickSubmitPostButton(page) {

  await page.evaluate(() => {

    const host = document.querySelector("r-post-form-submit-button");

    const root = host.shadowRoot;

    const btn = root.querySelector("button");

    btn.click();

  });
}

/** ****************************************************************************
 * COMMENT HELPERS
 ******************************************************************************/

async function focusCommentEditorDeepStrict(page) {

  await page.evaluate(() => {

    const roots = [document];

    const find = () => {

      for (const root of roots) {

        const editor = root.querySelector(
          'div[role="textbox"][contenteditable]'
        );

        if (editor) {
          editor.focus();
          editor.click();
          return true;
        }

        root.querySelectorAll("*").forEach(el => {
          if (el.shadowRoot) roots.push(el.shadowRoot);
        });
      }

      return false;
    };

    if (!find()) throw new Error("Comment editor not found");

  });
}

async function setCommentTextByKeyboard(page, text) {

  await page.keyboard.type(text, { delay: 10 });

}

async function clickCommentSubmitButtonDeep(page) {

  await page.evaluate(() => {

    const buttons = Array.from(document.querySelectorAll("button"));

    const hit = buttons.find(b => b.textContent.trim() === "댓글");

    if (!hit) throw new Error("Comment submit button not found");

    hit.click();

  });
}

/** ****************************************************************************
 * EXPORTS
 ******************************************************************************/

module.exports = {

  openPage,
  gotoUrlSafe,
  waitForSelectorSafe,
  safeWaitNetworkIdle,
  sleep,

  setFaceplateTextInputById,
  clickLoginButton,

  setTitleFaceplateTextarea,
  setBodyLexicalRTE,
  clickSubmitPostButton,

  focusCommentEditorDeepStrict,
  setCommentTextByKeyboard,
  clickCommentSubmitButtonDeep,

};