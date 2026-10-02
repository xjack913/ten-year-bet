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
    const nowYear = todayTPE().slice(0, 4);

    // 年份列：同一年的局合併成一格
    const yr = el("tr", { class: "years" });
    yr.append(el("th", { scope: "col" }));
    const groups = [];
    for (const r of rounds) {
      const y = r.end.slice(0, 4);
      if (groups.length && groups[groups.length - 1].y === y) groups[groups.length - 1].n += 1;
      else groups.push({ y, n: 1 });
    }
    for (const g of groups) {
      yr.append(el("th", { scope: "colgroup", colspan: g.n, class: g.y === nowYear ? "this-year" : null }, g.y));
    }
    yr.append(el("th", { class: "sum", colspan: 2 }));

    const hr = el("tr", { class: "rounds" });
    hr.append(el("th", { scope: "col" }, ""));
    for (const r of rounds) {
      const label = `第 ${r.n} 局：${fmtDay(nextDay(r.start))}～${fmtDay(r.end)}`;
      const isCur = current && r.n === current.n;
      hr.append(el("th", { scope: "col", title: label, "aria-label": label, class: isCur ? "is-current" : null }, String(r.n)));
    }
    hr.append(el("th", { scope: "col", class: "sum first-sum" }, "勝"));
    hr.append(el("th", { scope: "col", class: "sum", title: "截至上次結算" }, "累計"));
    thead.append(yr, hr);

    const wins = { me: settled.filter((r) => r.winner === "me").length, mil: settled.filter((r) => r.winner === "mil").length };
    const last = settled[settled.length - 1];
    const tbody = el("tbody");
    const rows = [
      { key: "mil", name: "岳母", tag: "波段操作派", ret: "milRet", nav: "mil_nav" },
      { key: "me", name: "叉傑克", tag: "大盤市值仔", ret: "meRet", nav: "xjack_nav" },
    ];
    let lit = 0;
    const litAttrs = (cls) => ({ class: `${cls || ""} lit`.trim(), style: `--i:${lit++}` });
    for (const row of rows) {
      const tr = el("tr", { class: `row-${row.key}` });
      const th = el("th", { scope: "row" }, row.name);
      th.append(el("small", {}, row.tag));
      tr.append(th);
      for (const r of rounds) {
        let td;
        if (r.settled) {
          const v = r[row.ret];
          const cls = r.winner === "tie" ? null : r.winner === row.key ? "win" : "lose";
          td = el("td", { ...litAttrs(cls), "aria-label": `第 ${r.n} 局 ${row.name} ${pct(v, 1)}${r.winner === row.key ? "，勝" : ""}` }, boardNum(v));
        } else if (current && r.n === current.n && phase !== "pre") {
          td = row.key === "me"
            ? el("td", { ...litAttrs("live"), "aria-label": `第 ${r.n} 局 叉傑克 目前 ${pct(meLive, 1)}` }, boardNum(meLive))
            : el("td", { ...litAttrs("hidden-val"), "aria-label": `第 ${r.n} 局 岳母 結算時揭曉` }, "?");
        } else if (current && r.n === current.n) {
          td = el("td", { class: "pregame", "aria-label": `第 ${r.n} 局 即將開打` }, "開打");
        } else {
          td = el("td", { class: "off", "aria-label": `第 ${r.n} 局 尚未開始` });
        }
        tr.append(td);
      }
      tr.append(el("td", { ...litAttrs("sum first-sum"), "aria-label": `${row.name} 勝場 ${wins[row.key]}` }, String(wins[row.key])));
      if (last) {
        const cum = last[row.nav] / base - 1;
        tr.append(el("td", { ...litAttrs("sum"), "aria-label": `${row.name} 累計 ${pct(cum, 1)}` }, boardNum(cum)));
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
    const label = phase === "pre" ? `第 ${current.n} 局 ${fmtMD(nextDay(current.start))} 開打`
      : phase === "live" ? `第 ${current.n} 局進行中` : `第 ${current.n} 局結算中`;
    status.append(dot, document.createTextNode(label));
    foot.textContent = settled.length || phase !== "pre"
      ? "數字是每局報酬率（%）。「?」是岳母的成績，結算時才揭曉。"
      : "數字是每局報酬率（%）。每局結算後，贏的那格會亮起來。";

    const cur = table.querySelector("tr.rounds th.is-current");
    const scroller = $("board-scroll");
    // 本局在可視範圍外才捲，而且讓本局靠右、前面比完的局留在畫面上
    if (cur && scroller.scrollWidth > scroller.clientWidth) {
      const overflow = cur.offsetLeft + cur.offsetWidth + 24 - scroller.clientWidth;
      if (overflow > 0) scroller.scrollLeft = overflow;
    }
  }

  // ---------- 倒數 ----------
  function renderCountdown(st) {
    const { current, phase } = st;
    if (!current) return;
    const today = todayTPE();
    const settling = phase === "settling";
    const target = settling ? current.reveal : current.end;
    const days = Math.max(0, Math.round((parseDay(target) - parseDay(today)) / DAY));
    $("cd-label").textContent = settling ? `第 ${current.n} 局比完了，揭曉倒數` : `第 ${current.n} 局結算倒數`;
    $("cd-days").textContent = String(days);
    $("cd-sub").textContent = settling
      ? `正在跟岳母對帳，${fmtDay(current.reveal)} 公開結果`
      : `${fmtDay(current.end)} 收盤結算，${fmtDay(current.reveal)} 公開結果`;
    $("countdown").hidden = false;
  }

  // ---------- 對戰卡 ----------
  function deltaSpan(r) {
    const cls = r > 0.00005 ? "up" : r < -0.00005 ? "down" : null;
    const arrow = r > 0.00005 ? "▲ " : r < -0.00005 ? "▼ " : "";
    return el("span", { class: cls }, `${arrow}${pct(r)}`);
  }

  function setFigure(node, nav, base) {
    node.replaceChildren(document.createTextNode((nav / base * 100).toFixed(2)), el("small", {}, "萬"));
  }

  function renderCorners(st, x) {
    const { latest, series, base, settled, current } = st;
    setFigure($("me-figure"), latest.nav, base);
    const meSub = $("me-sub");
    meSub.replaceChildren(document.createTextNode("累計 "), deltaSpan(latest.r));
    if (series.length === 1) {
      const fees = x.initial_buys.reduce((s, b) => s + b.fee, 0);
      meSub.append(document.createTextNode(`，買進手續費 ${int(fees)} 元`));
    } else {
      meSub.append(document.createTextNode(`，截至 ${fmtMD(latest.d)} 收盤`));
    }

    const last = settled[settled.length - 1];
    const milSub = $("mil-sub");
    if (last) {
      setFigure($("mil-figure"), last.mil_nav, base);
      milSub.replaceChildren(document.createTextNode("累計 "), deltaSpan(last.mil_nav / base - 1),
        document.createTextNode(`，第 ${last.n} 局結算`));
    } else {
      // 還沒結算過：顯示起點 100 萬（她是既有帳戶，起點沒有買進手續費）
      setFigure($("mil-figure"), base, base);
      milSub.replaceChildren(document.createTextNode(
        `${fmtMD(st.series[0].d)} 起點，每局結算才更新${current ? `，第一次 ${fmtDay(current.reveal)}` : ""}`));
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
    // 叉傑克：每日
    if (series.length > 1) {
      svg.append(sv("path", { class: "line-me", d: series.map((p, i) => `${i ? "L" : "M"}${X(p.t).toFixed(1)},${Y(p.r).toFixed(1)}`).join("") }));
    }
    for (const p of milPts) svg.append(sv("circle", { class: "dot dot-mil", cx: X(p.t), cy: Y(p.r), r: 5 }));
    const end = series[series.length - 1];
    svg.append(sv("circle", { class: "dot dot-me", cx: X(end.t), cy: Y(end.r), r: 5 }));

    // 端點標籤
    const labels = [];
    if (series.length > 1) labels.push({ x: X(end.t), y: Y(end.r), name: "叉傑克", v: pct(end.r) });
    if (milPts.length > 1) { const m = milPts[milPts.length - 1]; labels.push({ x: X(m.t), y: Y(m.r), name: "岳母", v: pct(m.r) }); }
    if (labels.length === 2 && Math.abs(labels[0].y - labels[1].y) < 30) {
      const [a, b] = labels[0].y <= labels[1].y ? labels : [labels[1], labels[0]];
      a.dy = -12; b.dy = 22;
    }
    for (const L of labels) {
      const right = L.x > W - M.right - 130;
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
    tip.append(row(css.getPropertyValue("--me"), pct(p.r), "叉傑克"));
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
    $("cash-note").textContent = `零頭現金 ${int(x.cash)} 元（買不滿一股的部分，不計利息）。`;

    const rebs = $("rebs");
    rebs.replaceChildren();
    if (!x.rebalances.length) {
      rebs.append(el("li", { class: "empty" }, `第一次再平衡在 ${x.rebalance.from_year} 年第一個交易日。`));
    }
    for (const r of x.rebalances) {
      const parts = r.trades.map((t) => t.side === "sell"
        ? `賣 ${t.code} ${int(t.shares)} 股（手續費 ${t.fee} 元、證交稅 ${t.tax} 元）`
        : `買 ${t.code} ${int(t.shares)} 股（手續費 ${t.fee} 元）`);
      rebs.append(el("li", {}, `${fmtDay(r.date)}：${parts.length ? parts.join("，") : "比例剛好，不用調"}`));
    }

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

  // ---------- 瀏覽人次 ----------
  // 正式網址才計數；同一個分頁工作階段只算一次，重新整理不重複 +1
  const COUNTER_URL = "https://bet-api.xjack.tw/views";
  async function renderViews() {
    if (location.hostname !== "bet.xjack.tw") return; // 本機預覽不接計數器（只收正式網址）
    let counted = false;
    try { counted = sessionStorage.getItem("bet-viewed") === "1"; } catch (e) { /* 無痕或封鎖儲存時照常顯示 */ }
    const post = !counted;
    try {
      const r = await fetch(COUNTER_URL, { method: post ? "POST" : "GET", cache: "no-store" });
      if (!r.ok) return;
      const { views } = await r.json();
      if (post) try { sessionStorage.setItem("bet-viewed", "1"); } catch (e) { /* 同上 */ }
      const node = $("views");
      node.replaceChildren(document.createTextNode("瀏覽 "), el("b", {}, int(views)), document.createTextNode(" 人次"));
      node.hidden = false;
    } catch (e) {
      // 計數器掛了就不顯示，不影響主畫面
    }
  }

  // ---------- 場邊押注 ----------
  // 正式網址接 bet-api；本機預覽接 wrangler dev（127.0.0.1:8787）
  const BET_URL = location.hostname === "bet.xjack.tw" ? "https://bet-api.xjack.tw/bets"
    : /^(localhost|127\.0\.0\.1)$/.test(location.hostname) ? "http://127.0.0.1:8787/bets" : null;
  const SIDE_NAME = { mil: "岳母", me: "叉傑克" };
  const WEEK = "日一二三四五六";

  // 裝置記住自己的隨機編號和押過哪邊；無痕或封鎖儲存時只記在這一頁
  const mem = {};
  const store = {
    get(k) { try { const v = localStorage.getItem(k); if (v != null) return v; } catch (e) { /* 改用記憶體 */ } return mem[k] ?? null; },
    set(k, v) { mem[k] = v; try { localStorage.setItem(k, v); } catch (e) { /* 同上 */ } },
  };
  function betToken() {
    const t = store.get("bet-token");
    if (t && /^[A-Za-z0-9-]{16,64}$/.test(t)) return t;
    const fresh = crypto.randomUUID ? crypto.randomUUID()
      : Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
    store.set("bet-token", fresh);
    return fresh;
  }
  function myPicks() {
    try { return JSON.parse(store.get("bet-picks")) || {}; } catch (e) { return {}; }
  }
  function savePick(round, side) {
    const p = myPicks();
    p[round] = { side, at: todayTPE() };
    store.set("bet-picks", JSON.stringify(p));
  }

  const tpe = (ms) => new Date(ms + 8 * 3600000);
  function closeLabel(ms) {
    const d = tpe(ms);
    return `${d.getUTCMonth() + 1}/${d.getUTCDate()}（${WEEK[d.getUTCDay()]}）${d.getUTCHours()}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
  }

  // 直接複製按鈕上的大頭（網址帶版本號，不會重抓）
  const face = (side) => document.querySelector(`.pick-${side} .face`).cloneNode(true);

  let betSt = null, betData = null, pending = null, busy = false, shareText = "";
  const SHARE_URL = "https://bet.xjack.tw/";

  async function copyShare() {
    let ok = false;
    try {
      await navigator.clipboard.writeText(shareText);
      ok = true;
    } catch (e) {
      // 舊瀏覽器或沒有剪貼簿權限：退回選取後複製
      const ta = el("textarea", { readonly: "", style: "position:fixed;top:0;left:0;opacity:0" });
      ta.value = shareText;
      document.body.append(ta);
      ta.select();
      try { ok = document.execCommand("copy"); } catch (e2) { ok = false; }
      ta.remove();
    }
    const btn = $("share-copy");
    $("pick-msg").textContent = ok
      ? "複製好了，貼到 LINE 群組或臉書給朋友吧！"
      : `沒辦法自動複製，請手動複製這段：${shareText.replace("\n", " ")}`;
    if (ok) {
      btn.textContent = "已複製！";
      setTimeout(() => { btn.textContent = "複製連結"; }, 2000);
    }
  }

  function renderBets(justPlaced) {
    const st = betSt, data = betData;
    const byN = new Map(st.rounds.map((r) => [r.n, r]));
    const open = data.open;
    const picks = myPicks();
    const mine = open ? picks[open.round] : null;

    // 標題與截止時間
    if (open) {
      const close = Date.parse(open.closes_at);
      // 跟比數板的倒數一樣用日曆天算
      const days = Math.round((parseDay(isoDay(tpe(close).getTime())) - parseDay(todayTPE())) / DAY);
      const when = days > 0 ? `還有 ${days} 天` : "今天就截止";
      $("pick-title").textContent = `第 ${open.round} 局，你壓誰贏？`;
      $("pick-sub").replaceChildren(document.createTextNode(`下注到 ${closeLabel(close)} 收盤，`),
        el("span", { class: "nb" }, `${when}。`), el("span", { class: "nb" }, `${fmtMD(byN.get(open.round).reveal)} 開獎。`));
    } else {
      $("pick-title").textContent = "十年押注結束";
      $("pick-sub").textContent = "20 局都比完了，下面是每一局大家壓誰的紀錄。";
    }

    // 還沒押：顯示按鈕；押過：換成下注單
    const btns = $("pick-btns");
    btns.hidden = !open || !!mine;
    for (const b of btns.querySelectorAll(".pick-btn")) {
      b.disabled = false;
      b.setAttribute("aria-pressed", String(b.dataset.side === pending));
    }
    const ticket = $("ticket");
    ticket.hidden = !mine;
    if (mine) {
      ticket.className = `ticket t-${mine.side}${justPlaced ? " just" : ""}`;
      const body = el("div", { class: "ticket-body" });
      body.append(el("p", { class: "ticket-title" }, `第 ${open.round} 局下注單`),
        el("p", { class: "ticket-pick" }, `壓${SIDE_NAME[mine.side]}`));
      const meta = el("p", { class: "ticket-meta" });
      meta.append(el("span", {}, `${fmtMD(mine.at)} 下注`), el("span", {}, `${fmtMD(byN.get(open.round).reveal)} 開獎`));
      body.append(meta);
      const stamp = el("div", { class: "ticket-stamp", "aria-hidden": "true" });
      stamp.append(document.createTextNode("買定"), el("br"), document.createTextNode("離手"));
      ticket.replaceChildren(face(mine.side), body, stamp);
    }

    // 押完才出現分享：LINE（官方網頁分享，手機電腦都能用）、臉書、複製連結
    $("share").hidden = !mine;
    if (mine) {
      const text = `叉傑克跟岳母的十年之約，第 ${open.round} 局我壓${SIDE_NAME[mine.side]}，你壓誰？`;
      const url = encodeURIComponent(SHARE_URL);
      $("share-line").href = `https://social-plugins.line.me/lineit/share?url=${url}&text=${encodeURIComponent(text)}`;
      $("share-fb").href = `https://www.facebook.com/sharer/sharer.php?u=${url}`;
      shareText = `${text}\n${SHARE_URL}`;
    }

    // 人氣條：這一局兩邊各幾個人
    const tug = $("tug");
    tug.hidden = !open;
    if (open) {
      const t = data.rounds.find((r) => r.n === open.round) || { mil: 0, me: 0 };
      const total = t.mil + t.me;
      const milPct = total ? Math.round(t.mil / total * 100) : 50;
      $("tug-mil-pct").textContent = String(milPct);
      $("tug-me-pct").textContent = String(100 - milPct);
      $("tug-mil").style.width = `${milPct}%`;
      $("tug-bar").classList.toggle("empty", !total);
      $("tug-bar").classList.toggle("split", t.mil > 0 && t.me > 0);
      $("tug-bar").setAttribute("aria-label", `目前壓岳母 ${t.mil} 人，壓叉傑克 ${t.me} 人`);
      $("tug-mil-n").textContent = `${int(t.mil)} 人`;
      $("tug-me-n").textContent = `${int(t.me)} 人`;
      const odds = $("odds");
      if (!total) odds.textContent = "還沒有人下注，來當第一個！";
      else if (!t.mil || !t.me) odds.textContent = `還沒有人壓${t.mil ? "叉傑克" : "岳母"}，現在壓就是全場唯一的勇者。`;
      else odds.textContent = `人氣賠率：岳母 1 賠 ${(total / t.mil).toFixed(2)}、叉傑克 1 賠 ${(total / t.me).toFixed(2)}（壓的人越少，賠率越高）`;
    }

    // 歷屆紀錄：新的在上面
    const tbody = $("bet-log").querySelector("tbody");
    tbody.replaceChildren();
    let hits = 0, played = 0;
    for (const t of [...data.rounds].reverse()) {
      const r = byN.get(t.n);
      const pick = picks[t.n];
      const total = t.mil + t.me;
      const tr = el("tr");
      tr.append(el("td", {}, `第 ${t.n} 局`));
      for (const side of ["mil", "me"]) {
        const td = el("td", { class: "num" }, `${int(t[side])} 人`);
        if (pick && pick.side === side) td.append(el("span", { class: "you-tag", title: "你壓這邊" }, "你"));
        tr.append(td);
      }
      const res = el("td", { class: "res" });
      if (r && r.settled) {
        if (r.winner === "tie") res.append(el("b", {}, "平手"));
        else {
          res.append(el("b", { class: `res-${r.winner}` }, `${SIDE_NAME[r.winner]}勝`));
          if (total) res.append(el("small", {}, `${Math.round(t[r.winner] / total * 100)}% 押中`));
        }
        if (pick) { played += 1; if (pick.side === r.winner) hits += 1; }
      } else if (open && t.n === open.round) {
        res.append(el("b", { class: "res-live" }, "下注中"));
      } else {
        res.append(el("b", { class: "res-wait" }, "等開獎"));
        if (r) res.append(el("small", {}, `${fmtMD(r.reveal)} 公布`));
      }
      tr.append(res);
      tbody.append(tr);
    }
    const rec = $("my-record");
    rec.hidden = !played;
    rec.textContent = played ? `你的戰績：押中 ${hits} 局，共押 ${played} 局` : "";
  }

  function choose(side) {
    if (busy) return;
    pending = side;
    for (const b of document.querySelectorAll(".pick-btn")) b.setAttribute("aria-pressed", String(b.dataset.side === side));
    $("confirm-q").textContent = `確定壓${SIDE_NAME[side]}嗎？壓了就不能改喔。`;
    const yes = $("confirm-yes");
    yes.textContent = `確定壓${SIDE_NAME[side]}`;
    yes.className = `btn-go go-${side}`;
    $("pick-confirm").hidden = false;
    $("pick-msg").textContent = "";
    yes.focus();
  }

  function cancelPick() {
    pending = null;
    for (const b of document.querySelectorAll(".pick-btn")) b.setAttribute("aria-pressed", "false");
    $("pick-confirm").hidden = true;
  }

  async function confirmPick() {
    if (!pending || busy || !betData || !betData.open) return;
    busy = true;
    const yes = $("confirm-yes");
    yes.disabled = true;
    const msg = $("pick-msg");
    msg.textContent = "送出中…";
    const round = betData.open.round, side = pending;
    let placed = false;
    try {
      // 不帶 Content-Type（純文字）就不用多一趟 CORS 預檢
      const r = await fetch(BET_URL, { method: "POST", body: JSON.stringify({ round, side, token: betToken() }), cache: "no-store" });
      const res = await r.json().catch(() => ({}));
      if (res.status === "ok" || res.status === "already") {
        savePick(round, res.side);
        betData = { open: res.open, rounds: res.rounds };
        placed = true;
        msg.textContent = res.status === "already" && res.side !== side
          ? `這支手機這局已經壓過${SIDE_NAME[res.side]}了，買定離手不能改喔。`
          : "下注成功！開獎那天回來看你有沒有押中。";
      } else if (res.status === "closed") {
        betData = { open: res.open, rounds: res.rounds };
        msg.textContent = "這局剛好截止了，換押下一局吧。";
      } else if (res.status === "limit") {
        msg.textContent = "同一個網路這局已經壓太多注了，換個網路再試試。";
      } else {
        msg.textContent = "沒送出去，請再按一次。";
      }
    } catch (e) {
      msg.textContent = "網路好像不太穩，沒送出去，請再按一次。";
    }
    busy = false;
    yes.disabled = false;
    if (placed || !betData.open || betData.open.round !== round) cancelPick();
    renderBets(placed);
    if (placed) $("ticket").focus();
  }

  async function initBets(st) {
    betSt = st;
    for (const b of document.querySelectorAll(".pick-btn")) b.addEventListener("click", () => choose(b.dataset.side));
    $("confirm-yes").addEventListener("click", confirmPick);
    $("confirm-no").addEventListener("click", cancelPick);
    $("share-copy").addEventListener("click", copyShare);
    const offline = () => { $("pick-sub").textContent = "押注區暫時連不上，晚點再回來看看。"; };
    if (!BET_URL) return offline();
    try {
      const r = await fetch(BET_URL, { cache: "no-store" });
      if (!r.ok) throw new Error(r.status);
      betData = await r.json();
      renderBets(false);
    } catch (e) {
      offline();
    }
  }

  // ---------- 啟動 ----------
  async function main() {
    renderViews();
    try {
      const opts = { cache: "no-cache" };
      const [x, s] = await Promise.all([
        fetch("data/xjack.json", opts).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); }),
        fetch("data/settlements.json", opts).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); }),
      ]);
      const st = derive(x, s);
      renderBoard(st);
      renderCorners(st, x);
      renderCountdown(st);
      initBets(st);
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
