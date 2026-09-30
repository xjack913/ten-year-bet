// bet.xjack.tw 的瀏覽人次計數器（Cloudflare Worker＋D1）
// GET  /views → 讀目前人次
// POST /views → 人次 +1 後回傳（只收 bet.xjack.tw 來的請求）
// 只存一個數字，不記 IP 或任何個人資料。

const ALLOWED_ORIGINS = ["https://bet.xjack.tw"];

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const headers = corsHeaders(origin);
    const { pathname } = new URL(request.url);

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (pathname !== "/views") return json({ error: "not found" }, 404, headers);

    if (request.method === "GET") {
      const row = await env.DB.prepare("SELECT value FROM counters WHERE name = 'bet'").first();
      return json({ views: row ? row.value : 0 }, 200, headers);
    }
    if (request.method === "POST") {
      if (!ALLOWED_ORIGINS.includes(origin)) return json({ error: "forbidden" }, 403, headers);
      const row = await env.DB.prepare(
        "INSERT INTO counters (name, value) VALUES ('bet', 1) " +
        "ON CONFLICT(name) DO UPDATE SET value = value + 1 RETURNING value"
      ).first();
      return json({ views: row.value }, 200, headers);
    }
    return json({ error: "method not allowed" }, 405, headers);
  },
};
