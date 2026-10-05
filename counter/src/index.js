// bet.xjack.tw 的後端（Cloudflare Worker＋D1）
//
// 瀏覽人次
//   GET  /views → 讀目前人次
//   POST /views → 人次 +1 後回傳（只收 bet.xjack.tw 來的請求）
//   只存一個數字，不記 IP 或任何個人資料。
//
// 場邊押注（純好玩，不用錢）
//   GET  /bets → 目前開放下注的局、各局押岳母／叉傑克的人數
//   POST /bets {round, side, token} → 押一注；同一個裝置每局一次，押了不能改
//   每局下注到該局結算日 13:30（收盤）截止，截止後自動開放下一局。
//   token 是瀏覽器自己產生的隨機編號；連線來源只存「加鹽雜湊」，鹽每局不同、
//   祕密鹽放在 Worker secret（BET_SALT），無法還原成 IP，只用來擋同一個來源狂灌票。
//
// 每日更新（Cron Trigger，時間寫在 wrangler.toml）
//   GitHub Actions 的 schedule 常延遲好幾個小時（2026/10/1、10/2 都晚了快 7 小時才跑），
//   所以改由這裡準時呼叫 GitHub API，觸發「每日更新與部署」workflow。
//   需要 Worker secret GH_TOKEN：fine-grained token，只給 ten-year-bet 這個 repo 的 Actions 讀寫權限。

const ALLOWED_ORIGINS = ["https://bet.xjack.tw"];
const UPDATE_WORKFLOW_URL =
  "https://api.github.com/repos/xjack913/ten-year-bet/actions/workflows/update.yml/dispatches";
const ROUNDS = 20;
const SIDES = ["mil", "me"];
const PER_SOURCE_LIMIT = 20; // 同一個連線來源每局最多幾注（家裡或公司共用網路會同一個來源）
const TOKEN_RE = /^[A-Za-z0-9-]{16,64}$/;

// 第 n 局截止時間：結算日 13:30 台北（= 05:30 UTC）
// 第 1 局 2026/12/31；之後偶數局 6/30、奇數局 12/31，第 20 局 2036/6/30
export function closesAt(n) {
  if (n === 1) return Date.UTC(2026, 11, 31, 5, 30);
  const year = 2027 + Math.floor((n - 2) / 2);
  return n % 2 === 0 ? Date.UTC(year, 5, 30, 5, 30) : Date.UTC(year, 11, 31, 5, 30);
}

// 現在開放下注的局：第一個還沒截止的局；20 局都截止了就是 null
export function openRound(now) {
  for (let n = 1; n <= ROUNDS; n++) if (now < closesAt(n)) return n;
  return null;
}

function allowedOrigins(env) {
  return env.DEV_ORIGIN ? [...ALLOWED_ORIGINS, env.DEV_ORIGIN] : ALLOWED_ORIGINS;
}

function corsHeaders(origin, env) {
  const list = allowedOrigins(env);
  return {
    "Access-Control-Allow-Origin": list.includes(origin) ? origin : list[0],
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
    "Cache-Control": "no-store",
  };
}

function json(body, status, headers) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json; charset=utf-8" },
  });
}

// IPv6 取前 64 位元（同一戶的裝置共用這段，換尾碼不能繞過上限）
export function sourceKey(ip) {
  if (!ip.includes(":")) return ip;
  const parts = ip.split("::");
  const head = parts[0] ? parts[0].split(":") : [];
  const tail = parts.length > 1 && parts[1] ? parts[1].split(":") : [];
  const full = [...head, ...Array(8 - head.length - tail.length).fill("0"), ...tail];
  return full.slice(0, 4).map((h) => parseInt(h || "0", 16).toString(16)).join(":") + "::/64";
}

async function sourceHash(salt, round, ip) {
  const data = new TextEncoder().encode(`${salt}|${round}|${sourceKey(ip)}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest).slice(0, 16)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function tallies(env) {
  const { results } = await env.DB.prepare(
    "SELECT name, value FROM counters WHERE name LIKE 'bet:%'"
  ).all();
  const byRound = new Map();
  for (const { name, value } of results) {
    const [, n, side] = name.split(":");
    const r = byRound.get(Number(n)) || { n: Number(n), mil: 0, me: 0 };
    if (SIDES.includes(side)) r[side] = value;
    byRound.set(Number(n), r);
  }
  return byRound;
}

async function betsState(env, now) {
  const open = openRound(now);
  const byRound = await tallies(env);
  const last = open ?? ROUNDS;
  const rounds = [];
  for (let n = 1; n <= last; n++) rounds.push(byRound.get(n) || { n, mil: 0, me: 0 });
  return {
    open: open ? { round: open, closes_at: new Date(closesAt(open)).toISOString() } : null,
    rounds,
  };
}

async function placeBet(request, env, now, headers) {
  if (!env.BET_SALT) return json({ status: "error", error: "not configured" }, 500, headers);
  let body;
  try { body = await request.json(); } catch (e) { return json({ status: "error", error: "bad json" }, 400, headers); }
  const round = Number(body && body.round);
  const side = body && body.side;
  const token = body && body.token;
  if (!Number.isInteger(round) || !SIDES.includes(side) || typeof token !== "string" || !TOKEN_RE.test(token)) {
    return json({ status: "error", error: "bad request" }, 400, headers);
  }

  const open = openRound(now);
  if (round !== open) return json({ status: "closed", ...(await betsState(env, now)) }, 409, headers);

  const existing = await env.DB.prepare("SELECT side FROM bets WHERE round = ? AND token = ?").bind(round, token).first();
  if (existing) return json({ status: "already", side: existing.side, ...(await betsState(env, now)) }, 200, headers);

  const ip = request.headers.get("CF-Connecting-IP") || "0.0.0.0";
  const src = await sourceHash(env.BET_SALT, round, ip);
  const used = await env.DB.prepare("SELECT COUNT(*) AS c FROM bets WHERE round = ? AND src = ?").bind(round, src).first();
  if (used.c >= PER_SOURCE_LIMIT) return json({ status: "limit" }, 429, headers);

  const ins = await env.DB.prepare(
    "INSERT INTO bets (round, token, side, src, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (round, token) DO NOTHING"
  ).bind(round, token, side, src, new Date(now).toISOString()).run();
  if (ins.meta.changes !== 1) {
    // 同一個裝置同時按兩次，另一次先寫進去了
    const row = await env.DB.prepare("SELECT side FROM bets WHERE round = ? AND token = ?").bind(round, token).first();
    return json({ status: "already", side: row ? row.side : side, ...(await betsState(env, now)) }, 200, headers);
  }
  await env.DB.prepare(
    "INSERT INTO counters (name, value) VALUES (?, 1) ON CONFLICT(name) DO UPDATE SET value = value + 1"
  ).bind(`bet:${round}:${side}`).run();
  return json({ status: "ok", side, ...(await betsState(env, now)) }, 200, headers);
}

// 丟錯讓 Cloudflare 把這次 Cron 記成失敗，在 Worker 的 Cron Events 看得到
export async function dispatchUpdate(env) {
  if (!env.GH_TOKEN) throw new Error("GH_TOKEN not configured");
  const res = await fetch(UPDATE_WORKFLOW_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.GH_TOKEN}`,
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "bet-counter",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ref: "main" }),
  });
  if (!res.ok) throw new Error(`workflow dispatch failed: ${res.status} ${await res.text()}`);
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const headers = corsHeaders(origin, env);
    const { pathname } = new URL(request.url);
    // 本機測試可用 DEV_NOW 模擬時間；正式環境沒有這個變數
    const now = env.DEV_NOW ? Date.parse(env.DEV_NOW) : Date.now();

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });

    if (pathname === "/views") {
      if (request.method === "GET") {
        const row = await env.DB.prepare("SELECT value FROM counters WHERE name = 'bet'").first();
        return json({ views: row ? row.value : 0 }, 200, headers);
      }
      if (request.method === "POST") {
        if (!allowedOrigins(env).includes(origin)) return json({ error: "forbidden" }, 403, headers);
        const row = await env.DB.prepare(
          "INSERT INTO counters (name, value) VALUES ('bet', 1) " +
          "ON CONFLICT(name) DO UPDATE SET value = value + 1 RETURNING value"
        ).first();
        return json({ views: row.value }, 200, headers);
      }
      return json({ error: "method not allowed" }, 405, headers);
    }

    if (pathname === "/bets") {
      if (request.method === "GET") return json(await betsState(env, now), 200, headers);
      if (request.method === "POST") {
        if (!allowedOrigins(env).includes(origin)) return json({ status: "error", error: "forbidden" }, 403, headers);
        return placeBet(request, env, now, headers);
      }
      return json({ error: "method not allowed" }, 405, headers);
    }

    return json({ error: "not found" }, 404, headers);
  },

  async scheduled(controller, env) {
    await dispatchUpdate(env);
  },
};
