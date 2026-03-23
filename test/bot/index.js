/* ============================================================
 * FILE: index.js  (STEP 2)
 * ============================================================
 * 실행:
 *  node index.js "오늘 가로수길에서 강아지 봤는데 너무 귀엽더라"
 *
 * 옵션:
 *  --seed=myseed           // 같은 입력/시드면 같은 출력(재현용)
 *  --temp=0.8              // 다양화 강도(0~1)
 *  --no-debug              // debug 출력 끄기
 */

const fs = require("fs");
const path = require("path");
const { Bot } = require("./bot");

/** ****************************************************************
 * parseArgs: 아주 간단한 CLI 옵션 파서
 ****************************************************************** */
function parseArgs(argv) {
  const opts = { seed: "", temp: NaN, debug: true, text: "" };

  const args = [...argv];
  const textParts = [];

  for (const a of args) {
    if (a.startsWith("--seed=")) opts.seed = a.slice("--seed=".length);
    else if (a.startsWith("--temp=")) opts.temp = Number(a.slice("--temp=".length));
    else if (a === "--no-debug") opts.debug = false;
    else textParts.push(a);
  }

  opts.text = textParts.join(" ").trim();
  return opts;
}

(function main() {
  /** ✅ config 우선순위: botConfig.json -> botConfig.sample.json */
  const primary = path.resolve(__dirname, "botConfig.json");
  const fallback = path.resolve(__dirname, "botConfig.sample.json");
  const configPath = fs.existsSync(primary) ? primary : fallback;

  if (!fs.existsSync(configPath)) {
    throw new Error("Missing config file: botConfig.json or botConfig.sample.json");
  }

  const cli = parseArgs(process.argv.slice(2));
  const input = cli.text || "오늘 가로수길에서 강아지 봤는데 너무 귀엽더라";

  const bot = Bot.fromJsonFile(configPath, { temperature: 0.85, repeatPenalty: 0.45 });

  const res = bot.respond(input, {
    seed: cli.seed || undefined,
    temperature: Number.isFinite(cli.temp) ? cli.temp : undefined,
    debug: cli.debug,
  });

  console.log("\n[CONFIG]", path.basename(configPath));
  console.log("\n[INPUT]\n", input);
  console.log("\n[BOT OUTPUT]\n", res.text);
  if (cli.debug) {
    console.log("\n[DEBUG]\n", res.debug);
  }
})();
