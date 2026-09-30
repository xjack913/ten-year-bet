(() => {
  "use strict";

  const SVGNS = "http://www.w3.org/2000/svg";
  const DAY = 86400000;
  const $ = (id) => document.getElementById(id);

  const parseDay = (s) => { const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d); };
  const isoDay = (t) => new Date(t).toISOString().slice(0, 10);
  const fmtDay = (s) => { const [y, m, d] = s.split("-").map(Number); return `${y}/${m}/${d}`; };
  const fmtMD = (s) => { const [, m, d] = s.split("-").map(Number); return `${m}/${d}`; };
  const nextDay = (s) => isoDay(parseDay(s) + DAY);
  const todayTPE = () => new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
  const sign = (r) => (r > 0.00005 ? "+" : r < -0.00005 ? "−" : "");
  const pct = (r, dp = 2) => `${sign(r)}${Math.abs(r * 100).toFixed(dp)}%`;
  const boardNum = (r) => `${sign(r)}${Math.abs(r * 100).toFixed(1)}`;
  const wan = (nav, base) => `${(nav / base * 100).toFixed(2)} 萬`;
  const int = (n) => n.toLocaleString("en-US");
  const money = (n) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });

  function el(tag, attrs = {}, text) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) if (v != null) e.setAttribute(k, v);
    if (text != null) e.textContent = text;
    return e;
  }
  function sv(tag, attrs = {}, text) {
    const e = document.createElementNS(SVGNS, tag);
    for (const [k, v] of Object.entries(attrs)) if (v != null) e.setAttribute(k, v);
    if (text != null) e.textContent = text;
    return e;
  }

  // ---------- 資料整理 ----------
  function derive(x, s) {
    const base = s.nav_base;
    const series = x.series.map(([d, nav]) => ({ d, t: parseDay(d), nav, r: nav / base - 1 }));
    const latest = series[series.length - 1];

    let prevMe = base, prevMil = base;
    const rounds = s.rounds.map((r) => {
      const o = { ...r, settled: r.xjack_nav != null && r.mil_nav != null, meStart: prevMe, milStart: prevMil };
      if (o.settled) {
        o.meRet = r.xjack_nav / prevMe - 1;
        o.milRet = r.mil_nav / prevMil - 1;
        o.winner = o.meRet > o.milRet ? "me" : o.meRet < o.milRet ? "mil" : "tie";
        prevMe = r.xjack_nav;
        prevMil = r.mil_nav;
      }
      return o;
    });
    const settled = rounds.filter((r) => r.settled);
    const current = rounds.find((r) => !r.settled) || null;

    let phase = "done", meLive = null;
    if (current) {
      const pts = series.filter((p) => p.d > current.start && p.d <= current.end);
      if (pts.length) meLive = pts[pts.length - 1].nav / current.meStart - 1;
      phase = todayTPE() > current.end ? "settling" : pts.length ? "live" : "pre";
    }
    return { base, series, latest, rounds, settled, current, phase, meLive };
  }

  // ---------- 比數板 ----------
  function renderBoard(st) {
    const { rounds, current, phase, meLive, settled, base } = st;
    const table = $("linescore");
    const thead = el("thead");
    const hr = el("tr");
    hr.append(el("th", { scope: "col" }));
    for (const r of rounds) {
      const label = `第 ${r.n} 局：${fmtDay(nextDay(r.start))}～${fmtDay(r.end)}`;
      const isCur = current && r.n === current.n && phase !== "done";
      hr.append(el("th", { scope: "col", title: label, "aria-label": label, class: isCur ? "is-current" : null }, String(r.n)));
    }
    hr.append(el("th", { scope: "col", class: "sum first-sum" }, "勝"));
    hr.append(el("th", { scope: "col", class: "sum", title: "截至上次結算" }, "累計"));
    thead.append(hr);

    const wins = { me: settled.filter((r) => r.winner === "me").length, mil: settled.filter((r) => r.winner === "mil").length };
    const last = settled[settled.length - 1];
    const tbody = el("tbody");
    const rows = [
      { key: "mil", name: "岳母", tag: "波段操作派", ret: "milRet", nav: "mil_nav" },
      { key: "me", name: "我", tag: "大盤市值仔", ret: "meRet", nav: "xjack_nav" },
    ];
    for (const row of rows) {
      const tr = el("tr");
      const th = el("th", { scope: "row" }, row.name);
      th.append(el("small", {}, row.tag));
      tr.append(th);
      for (const r of rounds) {
        let td;
        if (r.settled) {
          const v = r[row.ret];
          const cls = r.winner === "tie" ? null : r.winner === row.key ? "win" : "lose";
          td = el("td", { class: cls, "aria-label": `第 ${r.n} 局 ${row.name} ${pct(v, 1)}${r.winner === row.key ? "，勝" : ""}` }, boardNum(v));
        } else if (current && r.n === current.n && phase !== "pre") {
          if (row.key === "me") {
            td = el("td", { class: "live", "aria-label": `第 ${r.n} 局 我 目前 ${pct(meLive, 1)}` }, boardNum(meLive));
          } else {
            td = el("td", { class: "hidden-val", "aria-label": `第 ${r.n} 局 岳母 結算時揭曉` }, "?");
          }
        } else {
          td = el("td", { class: "off", "aria-label": `第 ${r.n} 局 尚未開始` });
        }
        tr.append(td);
      }
      tr.append(el("td", { class: "sum first-sum", "aria-label": `${row.name} 勝場 ${wins[row.key]}` }, String(wins[row.key])));
      if (last) {
        const cum = last[row.nav] / base - 1;
        tr.append(el("td", { class: "sum", "aria-label": `${row.name} 累計 ${pct(cum, 1)}` }, boardNum(cum)));
      } else {
        tr.append(el("td", { class: "sum dash", "aria-label": `${row.name} 累計 尚無結算` }, "—"));
      }
      tbody.append(tr);
    }
    table.querySelectorAll("thead, tbody").forEach((n) => n.remove());
    table.append(thead, tbody);

    const status = $("board-status");
    status.replaceChildren();
    const foot = $("board-foot");
    if (!current) {
      status.textContent = "十年之約完賽";
      foot.textContent = "數字是每局報酬率（%）。";
      return;
    }
    const dot = el("span", { class: "dot", "aria-hidden": "true" });
    const range = `${fmtDay(nextDay(current.start))}～${fmtDay(current.end)}`;
    if (phase === "pre") {
      status.append(dot, document.createTextNode(`第 ${current.n} 局 ${fmtMD(nextDay(current.start))} 開打`));
      foot.textContent = `第 ${current.n} 局：${range}，${fmtDay(current.reveal)} 公開結果。數字是每局報酬率（%）。`;
    } else if (phase === "live") {
      status.append(dot, document.createTextNode(`第 ${current.n} 局進行中`));
      foot.textContent = `第 ${current.n} 局：${range}，${fmtDay(current.reveal)} 公開結果。數字是每局報酬率（%），「?」是岳母的成績，結算時才揭曉。`;
    } else {
      status.append(dot, document.createTextNode(`第 ${current.n} 局結算中`));
      foot.textContent = `第 ${current.n} 局已經比完，正在對帳，${fmtDay(current.reveal)} 公開結果。`;
    }

    const cur = table.querySelector("th.is-current");
    const scroller = $("board-scroll");
    // 本局在可視範圍外才捲，而且讓本局靠右、前面比完的局留在畫面上
    if (cur && scroller.scrollWidth > scroller.clientWidth) {
      const overflow = cur.offsetLeft + cur.offsetWidth + 24 - scroller.clientWidth;
      if (overflow > 0) scroller.scrollLeft = overflow;
    }
  }

  // ---------- 雙方現況 ----------
  function setDelta(node, r, prefix) {
    node.className = "delta " + (r > 0.00005 ? "up" : r < -0.00005 ? "down" : "flat");
    node.textContent = `${prefix} ${r > 0.00005 ? "▲" : r < -0.00005 ? "▼" : ""} ${pct(r)}`.replace("  ", " ");
  }

  function renderSides(st, x) {
    const { latest, series, base, settled, current } = st;
    const figMe = $("me-figure");
    figMe.replaceChildren();
    figMe.append(el("span", { class: "from" }, "100 萬 →"), document.createTextNode(wan(latest.nav, base)));
    setDelta($("me-delta"), latest.r, "累計");
    if (series.length === 1) {
      const fees = x.initial_buys.reduce((s, b) => s + b.fee, 0);
      $("me-note").textContent = `${fmtMD(latest.d)} 收盤買進，手續費 ${int(fees)} 元已經扣掉。${fmtMD(nextDay(latest.d))} 開打，之後每個交易日自動更新。`;
    } else {
      $("me-note").textContent = `截至 ${fmtDay(latest.d)} 收盤，每個交易日自動更新。`;
    }

    const figMil = $("mil-figure");
    figMil.replaceChildren();
    const last = settled[settled.length - 1];
    const nextReveal = current ? `下一次 ${fmtDay(current.reveal)} 公開。` : "";
    if (last) {
      figMil.append(el("span", { class: "from" }, "100 萬 →"), document.createTextNode(wan(last.mil_nav, base)));
      setDelta($("mil-delta"), last.mil_nav / base - 1, "累計");
      $("mil-note").textContent = `截至第 ${last.n} 局結算（${fmtDay(last.settled_on || last.end)}）。${nextReveal}`;
    } else {
      figMil.textContent = "結算才揭曉";
      $("mil-delta").textContent = "";
      $("mil-note").textContent = `她用的是真實帳戶，每局結算時才對帳。${nextReveal}`;
    }
  }

  // ---------- 走勢圖 ----------
  function niceStep(span, count) {
    const raw = span / count;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const n = raw / mag;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
  }

  function xTicks(t0, t1) {
    const out = [];
    const d0 = new Date(t0);
    const spanDays = (t1 - t0) / DAY;
    if (spanDays <= 400) {
      // 每月 1 日一格；跨半年以上改成隔月，1 月標年份
      const every = spanDays > 200 ? 2 : 1;
      let y = d0.getUTCFullYear(), m = d0.getUTCMonth() + 1;
      if (m === 12) { m = 0; y += 1; }
      for (;;) {
        const t = Date.UTC(y, m, 1);
        if (t > t1) break;
        const month = m + 1;
        if (every === 1 || month % 2 === 1) out.push({ t, label: month === 1 ? `${y}/1` : `${month}月` });
        m += 1;
        if (m === 12) { m = 0; y += 1; }
      }
    } else {
      const every = spanDays > 2200 ? 2 : 1;
      for (let y = d0.getUTCFullYear() + 1; ; y += every) {
        const t = Date.UTC(y, 0, 1);
        if (t > t1) break;
        out.push({ t, label: String(y) });
      }
    }
    return out;
  }

  let chartState = null;

  function renderChart(st) {
    const box = $("chart");
    const W = box.clientWidth, H = box.clientHeight;
    if (!W || !H) return;
    const { series, settled, current, base, phase } = st;
    const narrow = W < 520;
    const M = { top: 26, right: narrow ? 14 : 24, bottom: 28, left: 46 };
    const pw = W - M.left - M.right, ph = H - M.top - M.bottom;

    const start = series[0];
    const milPts = [{ t: start.t, d: start.d, r: 0 }].concat(
      settled.map((r) => ({ t: parseDay(r.settled_on || r.end), d: r.settled_on || r.end, r: r.mil_nav / base - 1 })));

    const t0 = start.t;
    const t1 = Math.max(series[series.length - 1].t, current ? parseDay(current.end) : 0, milPts[milPts.length - 1].t);
    const vals = series.map((p) => p.r).concat(milPts.map((p) => p.r), [0]);
    let lo = Math.min(...vals), hi = Math.max(...vals);
    const minHalf = 0.02;
    if (hi - lo < minHalf * 2) { const mid = (hi + lo) / 2; lo = Math.min(lo, mid - minHalf); hi = Math.max(hi, mid + minHalf); }
    const step = niceStep(hi - lo, narrow ? 4 : 5);
    lo = Math.floor(lo / step) * step;
    hi = Math.ceil(hi / step) * step;

    const X = (t) => M.left + (t - t0) / (t1 - t0) * pw;
    const Y = (r) => M.top + (hi - r) / (hi - lo) * ph;

    const svg = sv("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "累計報酬走勢圖" });
    const grid = sv("g", { class: "grid" });
    const dp = step < 0.01 ? 1 : 0;
    for (let v = lo; v <= hi + step / 2; v += step) {
      const y = Y(v);
      if (Math.abs(v) > step / 1000) grid.append(sv("line", { x1: M.left, x2: W - M.right, y1: y, y2: y }));
      const label = Math.abs(v) < step / 1000 ? "0%" : `${v > 0 ? "+" : "−"}${Math.abs(v * 100).toFixed(dp)}%`;
      svg.append(sv("text", { class: "tick", x: M.left - 8, y: y + 4, "text-anchor": "end" }, label));
    }
    svg.prepend(grid);
    svg.append(sv("line", { class: "zero", x1: M.left, x2: W - M.right, y1: Y(0), y2: Y(0) }));

    for (const tk of xTicks(t0, t1)) {
      const x = X(tk.t);
      if (x < M.left + 16 || x > W - M.right - 8) continue;
      svg.append(sv("text", { class: "tick", x, y: H - 8, "text-anchor": "middle" }, tk.label));
    }
    svg.append(sv("text", { class: "tick", x: M.left, y: H - 8, "text-anchor": "start" }, fmtMD(start.d)));

    // 本局結算日
    if (current && phase !== "done") {
      const xr = X(parseDay(current.end));
      svg.append(sv("line", { class: "round-mark", x1: xr, x2: xr, y1: M.top - 6, y2: M.top + ph }));
      svg.append(sv("text", { class: "round-label", x: xr - 16, y: M.top - 12, "text-anchor": "end" }, `第 ${current.n} 局 ${fmtMD(current.end)} 結算`));
      const g = sv("g", { transform: `translate(${xr},${M.top - 16})` });
      g.append(sv("circle", { class: "reveal", r: 9 }));
      g.append(sv("text", { class: "reveal-q", y: 5, "text-anchor": "middle" }, "?"));
      svg.append(g);
    }

    // 岳母：只有結算點，虛線相連
    if (milPts.length > 1) {
      svg.append(sv("path", { class: "line-mil", d: milPts.map((p, i) => `${i ? "L" : "M"}${X(p.t).toFixed(1)},${Y(p.r).toFixed(1)}`).join("") }));
    }
    // 我：每日
    if (series.length > 1) {
      svg.append(sv("path", { class: "line-me", d: series.map((p, i) => `${i ? "L" : "M"}${X(p.t).toFixed(1)},${Y(p.r).toFixed(1)}`).join("") }));
    }
    for (const p of milPts) svg.append(sv("circle", { class: "dot dot-mil", cx: X(p.t), cy: Y(p.r), r: 5 }));
    const end = series[series.length - 1];
    svg.append(sv("circle", { class: "dot dot-me", cx: X(end.t), cy: Y(end.r), r: 5 }));

    // 端點標籤
    const labels = [];
    if (series.length > 1) labels.push({ x: X(end.t), y: Y(end.r), name: "我", v: pct(end.r) });
    if (milPts.length > 1) { const m = milPts[milPts.length - 1]; labels.push({ x: X(m.t), y: Y(m.r), name: "岳母", v: pct(m.r) }); }
    if (labels.length === 2 && Math.abs(labels[0].y - labels[1].y) < 30) {
      const [a, b] = labels[0].y <= labels[1].y ? labels : [labels[1], labels[0]];
      a.dy = -12; b.dy = 22;
    }
    for (const L of labels) {
      const right = L.x > W - M.right - 96;
      const t = sv("text", { class: "end-label", x: L.x + (right ? -10 : 10), y: L.y + (L.dy ?? -10), "text-anchor": right ? "end" : "start" });
      t.append(sv("tspan", {}, `${L.name} `), sv("tspan", { class: "end-label-sub" }, L.v));
      svg.append(t);
    }

    if (series.length === 1) {
      svg.append(sv("text", { class: "empty", x: M.left + pw / 2, y: M.top + ph / 2 - 16, "text-anchor": "middle" },
        `${fmtMD(nextDay(start.d))} 開打，每個交易日收盤後畫一格`));
    }

    // 互動：十字線＋提示
    const xh = sv("line", { class: "xhair", y1: M.top, y2: M.top + ph, visibility: "hidden" });
    const hl = sv("circle", { class: "dot dot-me", r: 5, visibility: "hidden" });
    const hit = sv("rect", { class: "hit", x: M.left, y: M.top, width: pw, height: ph, tabindex: 0,
      "aria-label": "走勢圖互動區，可用左右鍵逐日查看" });
    svg.append(xh, hl, hit);

    box.replaceChildren(svg);
    chartState = { st, series, milPts, X, Y, xh, hl, hit, svg, idx: series.length - 1 };
    bindChart();
  }

  function nearestIndex(series, t) {
    let lo = 0, hi = series.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (series[mid].t < t) lo = mid; else hi = mid; }
    return Math.abs(series[lo].t - t) <= Math.abs(series[hi].t - t) ? lo : hi;
  }

  function showAt(idx, clientX, clientY) {
    const cs = chartState;
    const p = cs.series[idx];
    cs.idx = idx;
    const x = cs.X(p.t), y = cs.Y(p.r);
    cs.xh.setAttribute("x1", x); cs.xh.setAttribute("x2", x); cs.xh.setAttribute("visibility", "visible");
    cs.hl.setAttribute("cx", x); cs.hl.setAttribute("cy", y); cs.hl.setAttribute("visibility", "visible");

    const tip = $("tip");
    tip.replaceChildren();
    tip.append(el("div", { class: "t-date" }, fmtDay(p.d)));
    const row = (color, value, name) => {
      const r = el("div", { class: "t-row" });
      const k = el("span", { class: "t-key" }); k.style.background = color;
      r.append(k, el("b", {}, value), el("span", {}, name));
      return r;
    };
    const css = getComputedStyle(document.documentElement);
    tip.append(row(css.getPropertyValue("--me"), pct(p.r), "我"));
    const m = cs.milPts.find((q) => q.d === p.d);
    if (m) tip.append(row(css.getPropertyValue("--mil"), pct(m.r), "岳母"));
    tip.hidden = false;

    if (clientX == null) {
      const r = cs.svg.getBoundingClientRect();
      const vb = cs.svg.viewBox.baseVal;
      clientX = r.left + x * r.width / vb.width;
      clientY = r.top + y * r.height / vb.height;
    }
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    let left = clientX + 14, top = clientY - th - 12;
    if (left + tw > window.innerWidth - 8) left = clientX - tw - 14;
    if (top < 8) top = clientY + 16;
    tip.style.left = `${Math.max(8, left)}px`;
    tip.style.top = `${top}px`;
  }

  function hideTip() {
    if (!chartState) return;
    chartState.xh.setAttribute("visibility", "hidden");
    chartState.hl.setAttribute("visibility", "hidden");
    $("tip").hidden = true;
  }

  function bindChart() {
    const cs = chartState;
    if (cs.series.length < 2) return;
    const toIdx = (ev) => {
      const r = cs.svg.getBoundingClientRect();
      const vb = cs.svg.viewBox.baseVal;
      const x = (ev.clientX - r.left) * vb.width / r.width;
      const t0 = cs.series[0].t;
      const tEnd = cs.series[cs.series.length - 1].t;
      const tx = t0 + (x - cs.X(t0)) / (cs.X(tEnd) - cs.X(t0)) * (tEnd - t0);
      return nearestIndex(cs.series, tx);
    };
    cs.hit.addEventListener("pointermove", (ev) => showAt(toIdx(ev), ev.clientX, ev.clientY));
    cs.hit.addEventListener("pointerdown", (ev) => showAt(toIdx(ev), ev.clientX, ev.clientY));
    cs.hit.addEventListener("pointerleave", hideTip);
    cs.hit.addEventListener("blur", hideTip);
    cs.hit.addEventListener("focus", () => showAt(cs.idx));
    cs.hit.addEventListener("keydown", (ev) => {
      const n = cs.series.length;
      const moves = { ArrowLeft: -1, ArrowRight: 1, Home: -n, End: n };
      if (!(ev.key in moves)) return;
      ev.preventDefault();
      showAt(Math.min(n - 1, Math.max(0, cs.idx + moves[ev.key])));
    });
  }

  // ---------- 持股 ----------
  function renderHoldings(x) {
    const tbody = $("holdings").querySelector("tbody");
    tbody.replaceChildren();
    for (const h of x.holdings) {
      const buy = x.initial_buys.find((b) => b.code === h.code);
      const tr = el("tr");
      const name = el("td", {}, h.code);
      name.append(el("small", {}, `${h.name} ${Math.round(h.weight * 100)}%`));
      tr.append(name,
        el("td", { class: "num" }, h.base_close.toFixed(2)),
        el("td", { class: "num" }, int(h.shares)),
        el("td", { class: "num" }, int(buy.fee)));
      tbody.append(tr);
    }
    $("cash-note").textContent = `零頭現金 ${money(x.cash)} 元（買不滿一股的部分，不計利息）。`;
    const list = $("divs");
    list.replaceChildren();
    if (!x.dividends.length) {
      list.append(el("li", { class: "empty" }, "還沒有配息紀錄。"));
      return;
    }
    for (const d of x.dividends) {
      const bought = d.bought ? `用當天收盤 ${d.close} 元買回 ${int(d.bought)} 股（手續費 ${d.fee} 元）` : "不夠買一股，先留著當現金";
      list.append(el("li", {}, `${fmtDay(d.ex_date)} ${d.code} 每股配 ${d.per_share} 元，共 ${money(d.received)} 元，${bought}`));
    }
  }

  // ---------- 啟動 ----------
  async function main() {
    try {
      const opts = { cache: "no-cache" };
      const [x, s] = await Promise.all([
        fetch("data/xjack.json", opts).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); }),
        fetch("data/settlements.json", opts).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); }),
      ]);
      const st = derive(x, s);
      renderBoard(st);
      renderSides(st, x);
      renderHoldings(x);
      $("updated").textContent = `最後更新：${fmtDay(x.as_of)} 收盤。`;
      renderChart(st);
      let raf = 0;
      new ResizeObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { hideTip(); renderChart(st); }); }).observe($("chart"));
    } catch (err) {
      $("board-status").textContent = "資料載入失敗，請重新整理頁面。";
      console.error(err);
    }
  }

  main();
})();
