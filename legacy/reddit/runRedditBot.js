// runRedditBot.js

require("dotenv").config();

/* eslint-disable no-console */
const { 
    enterSite, 
    gotoUrlSafe, 
    loginRedditAuto, 
    searchAndScroll, 
    enterSubreddit, 
    createTextPost, 
    createComment
} = require("./redditBot");

(async () => {
    const username = process.env.REDDIT_USERNAME;
    const password = process.env.REDDIT_PASSWORD;

    if (!username || !password) {
        console.error("[runRedditBot] ❌ .env에 REDDIT_USERNAME/REDDIT_PASSWORD 설정 필요");
        process.exit(1);
    }

    const { browser, page: firstPage } = await enterSite({
        headless: false,
        profileKey: "reddit_kr",
        targetUrl: "https://www.reddit.com/",
    });

    let page = firstPage;

    page.on("console", (msg) => console.log("[browser]", msg.text()));
    page.on("pageerror", (err) => console.log("[browser:pageerror]", err?.message || err));

    try {
        console.log("[reddit] open home");
        page = await gotoUrlSafe(page, "https://www.reddit.com/", {
            waitUntil: "domcontentloaded",
            timeout: 30000,
        });

        console.log("[reddit] login start");
        page = await loginRedditAuto(page, { username, password }); // ✅ page 반환 받기
        console.log("[reddit] login done");

        // /** 검색 */ 
        // await searchAndScroll(page, { keyword: "stem cell clinic", rounds: 3, delayMs: 900 });
        
        // /** 서브레딧 */ 
        // await enterSubreddit(page, "test");
        
        // /** 글 작성 */ 
        // await createTextPost(page, { 
        //   pickValue: "u/Projection3141", 
        //   title: "Test post", 
        //   body: "Hello World!", 
        // });

        /** 댓글 작성 */
        page = await createComment(page, {
            url: "https://www.reddit.com/user/Projection3141/comments/1r9qe82/test_post/",
            commentText: "test comment2",
        });

        console.log("[runRedditBot] comment done");
        console.log("[runRedditBot] ✅ done");
    } catch (e) {
        console.error("[runRedditBot] ❌ failed:", e?.message || e);
        process.exitCode = 1;
    } finally {
        await browser.close().catch(() => { });
    }
})();