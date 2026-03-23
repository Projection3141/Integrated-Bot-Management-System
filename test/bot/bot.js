/* ============================================================
 * FILE: bot.js  (STEP 2)
 * ============================================================
 * ✅ Step 2 구현 포인트
 * 1) 반응 점수화 강화: 선호/비선호 + 텍스트 감정 힌트 혼합
 * 2) 다양화:
 *    - seed 옵션(재현 가능)
 *    - 템플릿/단어/연관어 반복 억제(최근 사용 메모리 기반 페널티)
 *    - 다중 키워드(최대 2개) 자연스럽게 엮기
 * 3) 외부 라이브러리 0개
 */

const fs = require("fs");

/** ****************************************************************
 * normalizeText: 간단 전처리
 ****************************************************************** */
function normalizeText(s) {
  return String(s || "").replace(/\s+/g, " ").trim();
}

/** ****************************************************************
 * clamp: 값 범위 제한
 ****************************************************************** */
function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

/** ****************************************************************
 * createRng(seed): 재현 가능한 랜덤
 * - 외부 라이브러리 없이 botId + inputText (+ seedOverride)로 고정 가능
 ****************************************************************** */
function createRng(seedStr) {
  let seed = 2166136261;
  for (let i = 0; i < seedStr.length; i += 1) {
    seed ^= seedStr.charCodeAt(i);
    seed = Math.imul(seed, 16777619);
  }
  seed >>>= 0;

  return function rng() {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    seed >>>= 0;
    return seed / 4294967296;
  };
}

/** ****************************************************************
 * chance: 확률
 ****************************************************************** */
function chance(p, rng) {
  return rng() < p;
}

/** ****************************************************************
 * safeReplaceAll: Node 환경 replaceAll 지원 여부 대비
 ****************************************************************** */
function safeReplaceAll(str, find, rep) {
  const s = String(str);
  if (typeof s.replaceAll === "function") return s.replaceAll(find, rep);
  return s.split(find).join(rep);
}

/** ****************************************************************
 * renderTemplate: 템플릿 치환
 * - Step 2: kw2, assoc3 슬롯 추가 지원
 ****************************************************************** */
function renderTemplate(tpl, vars) {
  let out = String(tpl || "");

  const pairs = [
    ["{exclaim}", vars.exclaim ?? ""],
    ["{empathy}", vars.empathy ?? ""],
    ["{tic}", vars.tic ?? ""],
    ["{connector}", vars.connector ?? ""],
    ["{thought}", vars.thought ?? ""],
    ["{emoji}", vars.emoji ?? ""],
    ["{kwMain}", vars.kwMain ?? ""],
    ["{kw2}", vars.kw2 ?? ""],
    ["{assoc1}", vars.assoc1 ?? ""],
    ["{assoc2}", vars.assoc2 ?? ""],
    ["{assoc3}", vars.assoc3 ?? ""],
  ];

  for (const [k, v] of pairs) out = safeReplaceAll(out, k, String(v));

  /** 템플릿 잔여 공백 정리 */
  return out.replace(/\s+/g, " ").trim();
}

/** ****************************************************************
 * toTemplateArray:
 * - config.templates.* 가 ["...","..."] 또는 [{text, weight, id}] 둘 다 지원
 ****************************************************************** */
function toTemplateArray(templates) {
  const arr = Array.isArray(templates) ? templates : [];
  return arr
    .map((t, idx) => {
      if (typeof t === "string") return { id: `tpl_${idx}`, weight: 1, text: t };
      if (t && typeof t === "object" && typeof t.text === "string") {
        return {
          id: String(t.id || `tpl_${idx}`),
          weight: Number.isFinite(t.weight) ? Number(t.weight) : 1,
          text: t.text,
        };
      }
      return null;
    })
    .filter(Boolean);
}

/** ****************************************************************
 * weightedPick:
 * - weight 기반 선택 + 최근 사용 페널티(반복 억제)
 * - temperature: 0~1 (0이면 가장 높은 가중치 쪽으로 치우침, 1이면 랜덤성 증가)
 ****************************************************************** */
function weightedPick(items, rng, opts = {}) {
  const {
    temperature = 0.6,
    recentIds = [],
    repeatPenalty = 0.45, // 최근에 썼던 항목이면 weight에 곱해지는 페널티(낮을수록 더 강한 억제)
  } = opts;

  if (!items || items.length === 0) return null;

  /** 1) 유효 가중치 계산 */
  const rec = new Set(recentIds);
  const scored = items.map((it) => {
    const base = Math.max(0.0001, Number(it.weight) || 1);
    const penalized = rec.has(it.id) ? base * repeatPenalty : base;

    /**
     * 2) temperature 반영:
     * - temperature 낮을수록(0에 가까울수록) 큰 weight가 더 우세
     * - 간단히 exponent로 조정 (0.2~2.5 범위)
     */
    const exp = clamp(2.5 - temperature * 2.3, 0.2, 2.5);
    const w = Math.pow(penalized, exp);

    return { ...it, _w: w };
  });

  const sum = scored.reduce((a, b) => a + b._w, 0);
  if (sum <= 0) return scored[0];

  /** 3) 룰렛 휠 */
  let r = rng() * sum;
  for (const it of scored) {
    r -= it._w;
    if (r <= 0) return it;
  }
  return scored[scored.length - 1];
}

/** ****************************************************************
 * spotKeywords:
 * - Step 2: “조사/어미 붙은 형태”를 아주 가볍게 허용(정규식 1번)
 * - ex) "강아지", "강아지를", "강아지랑", "가로수길에서" 등
 ****************************************************************** */
function spotKeywords(text, dictionaryKeys) {
  const t = normalizeText(text);

  /** 긴 키워드 우선 */
  const keys = Array.from(new Set(dictionaryKeys))
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);

  const hits = [];
  for (const k of keys) {
    /** 1) 단순 includes */
    if (t.includes(k)) {
      hits.push(k);
      continue;
    }

    /** 2) 아주 얕은 조사 패턴 (키워드 뒤 0~3글자 정도 조사/어미를 허용) */
    const re = new RegExp(`${escapeRegExp(k)}[가-힣]{0,3}`, "g");
    if (re.test(t)) hits.push(k);
  }

  return hits;
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** ****************************************************************
 * inferLocalSentiment:
 * - lexicon 기반 감정 힌트 (긍/부정/중립)
 * - Step 2: 강도(intensity)도 같이 추정(0~1)
 ****************************************************************** */
function inferLocalSentiment(text, lexicon) {
  const t = normalizeText(text);

  const posList = lexicon?.positive || [];
  const negList = lexicon?.negative || [];

  let posHit = 0;
  let negHit = 0;

  for (const w of posList) if (w && t.includes(w)) posHit += 1;
  for (const w of negList) if (w && t.includes(w)) negHit += 1;

  const total = posHit + negHit;
  const intensity = clamp(total / 3, 0, 1); // 0~1 정도로만

  if (posHit > 0 && negHit === 0) return { label: "positive", intensity };
  if (negHit > 0 && posHit === 0) return { label: "negative", intensity };
  return { label: "neutral", intensity };
}

/** ****************************************************************
 * scorePreference:
 * - hits 기반 선호 점수 산출 + 키워드별 점수 반환
 ****************************************************************** */
function scorePreference(hits, likes, dislikes) {
  let score = 0;
  const perKw = [];

  for (const k of hits) {
    const like = likes && Object.prototype.hasOwnProperty.call(likes, k) ? Number(likes[k]) || 0 : 0;
    const dislike =
      dislikes && Object.prototype.hasOwnProperty.call(dislikes, k) ? Number(dislikes[k]) || 0 : 0;

    const s = like - dislike;
    score += s;

    perKw.push({ k, score: s, like, dislike });
  }

  return { score, perKw };
}

/** ****************************************************************
 * pickTopKeywords:
 * - 대표 키워드(kwMain) + 보조 키워드(kw2) 선정
 * - Step 2: perKw 기반 “절대값 큰 것” 우선 + 중복/최근 사용 회피
 ****************************************************************** */
function pickTopKeywords(perKw, recentKw = [], max = 2) {
  const rec = new Set(recentKw);
  const sorted = [...perKw].sort((a, b) => Math.abs(b.score) - Math.abs(a.score));

  const picked = [];
  for (const it of sorted) {
    if (!it?.k) continue;
    if (picked.includes(it.k)) continue;

    /** 최근 키워드면 뒤로 */
    if (rec.has(it.k) && sorted.length > max) continue;

    picked.push(it.k);
    if (picked.length >= max) break;
  }

  /** recent 때문에 못 뽑았으면 fallback */
  if (picked.length === 0 && sorted[0]?.k) picked.push(sorted[0].k);

  return { kwMain: picked[0] || null, kw2: picked[1] || null };
}

/** ****************************************************************
 * expandAssociations:
 * - hit 키워드들의 연관어 풀에서 1~3개 선택
 * - 최근 연관어 반복 억제
 ****************************************************************** */
function expandAssociations(hits, associations, rng, opts = {}) {
  const { recentAssoc = [], max = 3 } = opts;

  const pool = [];
  for (const k of hits) {
    const arr = associations?.[k];
    if (Array.isArray(arr)) pool.push(...arr);
  }

  let uniq = Array.from(new Set(pool)).filter(Boolean);
  if (uniq.length === 0) return { assoc1: null, assoc2: null, assoc3: null };

  /** 최근 연관어는 후보에서 약간 제외(완전 제외는 아님) */
  const rec = new Set(recentAssoc);
  const fresh = uniq.filter((w) => !rec.has(w));
  if (fresh.length >= 2) uniq = fresh;

  /** 단순 랜덤 선택 */
  const pickN = [];
  while (uniq.length > 0 && pickN.length < max) {
    const idx = Math.floor(rng() * uniq.length);
    pickN.push(uniq[idx]);
    uniq.splice(idx, 1);
  }

  return {
    assoc1: pickN[0] || null,
    assoc2: pickN[1] || null,
    assoc3: pickN[2] || null,
  };
}

/** ****************************************************************
 * buildSlots:
 * - 말버릇/연결어/감탄/이모지 다양화 + 최근 사용 페널티
 ****************************************************************** */
function buildSlots(bot, plan, rng, memory) {
  const style = bot.style || {};

  const exclaimBank =
    plan.category === "positive"
      ? ["좋았겠다!", "와…", "오 진짜?", "완전 부럽다!"]
      : plan.category === "negative"
        ? ["음…", "흠…", "그건 좀", "조금 애매하네…"]
        : ["오!", "아하", "그렇구나", "음 그렇네"];

  const empathyBank =
    plan.category === "positive"
      ? ["공감돼요.", "완전 이해돼요.", "그런 순간 있죠.", "그 말 뭔지 알겠어요."]
      : plan.category === "negative"
        ? ["그럴 수 있죠.", "이해는 돼요.", "그런 얘기 들으면 그렇죠.", "그 부분은 조심스러워요."]
        : ["그렇네요.", "음 그렇구나.", "아 그랬구나.", "그런 느낌이군요."];

  /** 최근 사용한 connector/tic는 페널티 주기 위해 최근 리스트를 활용 */
  const tic = pickAvoidRecent(style.tics || ["약간"], rng, memory.recentTics, 0.5) || "";
  const connector = pickAvoidRecent(style.connectors || ["그리고"], rng, memory.recentConnectors, 0.5) || "그리고";

  const thought =
    plan.category === "positive"
      ? pickAvoidRecent(bot.thoughtBank?.positive || [], rng, memory.recentThoughts, 0.6)
      : plan.category === "negative"
        ? pickAvoidRecent(bot.thoughtBank?.negative || [], rng, memory.recentThoughts, 0.6)
        : pickAvoidRecent(
            [
              "생각보다 여러 방향으로 이어질 수 있겠네요",
              "어떤 포인트가 제일 인상적이었어요?",
              "그 얘기 듣고 나니까 다른 것도 떠오르네요",
            ],
            rng,
            memory.recentThoughts,
            0.6
          );

  const exclaim = pickAvoidRecent(exclaimBank, rng, memory.recentExclaims, 0.6);
  const empathy = pickAvoidRecent(empathyBank, rng, memory.recentEmpathies, 0.6);

  const emoji =
    (style.emojis && style.emojis.length > 0 && chance(style.emojiRate ?? 0, rng))
      ? ` ${pickAvoidRecent(style.emojis, rng, memory.recentEmojis, 0.5)}`
      : "";

  /** 최근 사용 기록 업데이트(너무 길어지지 않게 N개 유지) */
  pushRecent(memory.recentTics, tic, 6);
  pushRecent(memory.recentConnectors, connector, 6);
  pushRecent(memory.recentThoughts, thought, 6);
  pushRecent(memory.recentExclaims, exclaim, 6);
  pushRecent(memory.recentEmpathies, empathy, 6);
  if (emoji) pushRecent(memory.recentEmojis, emoji.trim(), 6);

  return { exclaim, empathy, tic, connector, thought, emoji };
}

function pushRecent(arr, val, maxLen) {
  if (!val) return;
  arr.push(val);
  while (arr.length > maxLen) arr.shift();
}

/**
 * pickAvoidRecent:
 * - 최근 사용 값이면 확률적으로 회피
 * - avoidRate: 0~1 (1이면 가능한 한 피함)
 */
function pickAvoidRecent(arr, rng, recentArr, avoidRate = 0.6) {
  if (!arr || arr.length === 0) return null;

  const rec = new Set(recentArr || []);
  const fresh = arr.filter((x) => !rec.has(x));

  /** fresh가 충분히 있으면 fresh에서 우선 선택 */
  if (fresh.length >= 1 && chance(avoidRate, rng)) return fresh[Math.floor(rng() * fresh.length)];

  /** 아니면 전체에서 선택 */
  return arr[Math.floor(rng() * arr.length)];
}

/** ****************************************************************
 * Bot: Step 2
 * - state-less(학습/감쇠 없음)지만,
 *   “최근 출력 메모리(인스턴스 메모리)”로 반복 억제만 수행
 ****************************************************************** */
class Bot {
  constructor(config, opts = {}) {
    this.config = config;

    /** ----------------------------------------------------------
     * memory: Step 2에서만 쓰는 "최근 사용 기록"
     * - process 살아있는 동안만 유지(파일 저장 없음)
     * - Step 3에서 state로 확장 가능
     * --------------------------------------------------------- */
    this.memory = {
      recentTemplateIds: [],
      recentKw: [],
      recentAssoc: [],
      recentConnectors: [],
      recentTics: [],
      recentThoughts: [],
      recentExclaims: [],
      recentEmpathies: [],
      recentEmojis: [],
    };

    /** 기본 옵션 */
    this.defaults = {
      temperature: Number.isFinite(opts.temperature) ? opts.temperature : 0.65,
      repeatPenalty: Number.isFinite(opts.repeatPenalty) ? opts.repeatPenalty : 0.45,
    };
  }

  /**
   * respond(inputText, options)
   * @param {string} inputText
   * @param {object} options
   * @param {string} options.seed - RNG seed override (재현용)
   * @param {number} options.temperature - 다양화 강도(0~1)
   * @param {boolean} options.debug - debug 정보 포함 여부
   */
  respond(inputText, options = {}) {
    const bot = this.config;
    const text = normalizeText(inputText);

    const temperature = Number.isFinite(options.temperature) ? options.temperature : this.defaults.temperature;
    const repeatPenalty = Number.isFinite(options.repeatPenalty) ? options.repeatPenalty : this.defaults.repeatPenalty;

    /** ✅ seed: botId + inputText + seedOverride */
    const seedCore = options.seed ? `${options.seed}` : "";
    const rng = createRng(`${bot.id}::${text}::${seedCore}`);

    /** ✅ 사전 키 */
    const likeKeys = Object.keys(bot.preferences?.likes || {});
    const dislikeKeys = Object.keys(bot.preferences?.dislikes || {});
    const assocKeys = Object.keys(bot.associations || {});
    const dictionaryKeys = Array.from(new Set([...likeKeys, ...dislikeKeys, ...assocKeys]));

    /** 1) 키워드 스팟팅 */
    const hits = spotKeywords(text, dictionaryKeys);

    /** 2) 선호 점수 + 키워드별 점수 */
    const { score: prefScoreRaw, perKw } = scorePreference(
      hits,
      bot.preferences?.likes,
      bot.preferences?.dislikes
    );

    /** 3) 감정 힌트(강도 포함) */
    const sent = inferLocalSentiment(text, bot.sentimentLexicon);

    /**
     * 4) 카테고리 결정(혼합)
     * - prefScoreRaw 가 주도
     * - sent.intensity로 살짝 보정
     */
    const sentBoost = sent.label === "positive" ? 0.35 * sent.intensity : sent.label === "negative" ? -0.35 * sent.intensity : 0;
    const prefScore = prefScoreRaw + sentBoost;

    let category = "neutral";
    if (prefScore >= 0.55) category = "positive";
    else if (prefScore <= -0.55) category = "negative";
    else category = sent.label; // 애매하면 텍스트 감정 힌트

    /** 5) 대표 키워드 1~2개 */
    const { kwMain, kw2 } = pickTopKeywords(perKw.length ? perKw : hits.map((k) => ({ k, score: 0 })), this.memory.recentKw, 2);

    /** 대표 키워드 fallback */
    const finalKwMain = kwMain || (hits[0] || "그 얘기");
    const finalKw2 = kw2 || null;

    /** 최근 키워드 기록 업데이트 */
    pushRecent(this.memory.recentKw, finalKwMain, 8);
    if (finalKw2) pushRecent(this.memory.recentKw, finalKw2, 8);

    /** 6) 연관어 1~3개 */
    const assoc = expandAssociations(
      hits.length ? hits : [finalKwMain],
      bot.associations,
      rng,
      { recentAssoc: this.memory.recentAssoc, max: 3 }
    );

    /** 최근 연관어 기록 업데이트 */
    [assoc.assoc1, assoc.assoc2, assoc.assoc3].filter(Boolean).forEach((w) => pushRecent(this.memory.recentAssoc, w, 10));

    /** 7) 템플릿 선택(가중치 + 반복 억제) */
    const tplArr = toTemplateArray(bot.templates?.[category] || bot.templates?.neutral || []);
    const tpl = weightedPick(tplArr, rng, {
      temperature,
      recentIds: this.memory.recentTemplateIds,
      repeatPenalty,
    }) || { id: "tpl_fallback", text: "{kwMain} 얘기네요." };

    /** 최근 템플릿 기록 업데이트 */
    pushRecent(this.memory.recentTemplateIds, tpl.id, 8);

    /** 8) 슬롯(어투 요소) 구성 */
    const slots = buildSlots(bot, { category }, rng, this.memory);

    /** 9) kw2 활용: 템플릿이 kw2를 포함하지 않으면, 확률적으로 간단 연결 문구를 붙임 */
    let kw2Addon = "";
    if (finalKw2 && !String(tpl.text).includes("{kw2}")) {
      const addonBank = [
        ` ${slots.connector} ${finalKw2} 얘기도 같이 떠오르네요.`,
        ` ${slots.connector} ${finalKw2}랑도 묘하게 연결돼요.`,
        ` ${slots.connector} ${finalKw2} 쪽도 생각나고요.`,
      ];
      if (chance(0.55, rng)) kw2Addon = addonBank[Math.floor(rng() * addonBank.length)];
    }

    /** 10) 렌더 */
    const out = renderTemplate(tpl.text, {
      ...slots,
      kwMain: finalKwMain,
      kw2: finalKw2 || "",
      assoc1: assoc.assoc1 || "연관된 얘기",
      assoc2: assoc.assoc2 || "다른 포인트",
      assoc3: assoc.assoc3 || "",
    }) + kw2Addon;

    const result = {
      text: out.replace(/\s+/g, " ").trim(),
    };

    /** debug 옵션 */
    if (options.debug !== false) {
      result.debug = {
        hits,
        perKw,
        kwMain: finalKwMain,
        kw2: finalKw2,
        assoc,
        prefScoreRaw,
        sent,
        prefScoreMixed: prefScore,
        category,
        templateId: tpl.id,
        temperature,
      };
    }

    return result;
  }

  /** json 로더: 확장자 무관(내용이 JSON이면 OK) */
  static fromJsonFile(filePath, opts) {
    const raw = fs.readFileSync(filePath, "utf8");
    const cfg = JSON.parse(raw);
    return new Bot(cfg, opts);
  }
}

module.exports = { Bot };
