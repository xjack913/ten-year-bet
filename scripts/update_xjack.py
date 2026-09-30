#!/usr/bin/env python3
"""每日更新「大盤市值仔」試算帳本。

抓臺灣證券交易所的收盤價與除息資料，從起算日重算每日淨值，寫進 data/xjack.json。
規則：起算日收盤價依權重買進、之後不買不賣；配息在除息日用當天收盤價再投入同一檔。

遇到沒辦法自動處理的狀況（分割、股票股利、單日漲跌超過 25%、缺價）一律直接失敗，
寧可網站停在舊資料，也不要公開錯的數字。
"""
import csv
import json
import ssl
import sys
import time
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
TPE = timezone(timedelta(hours=8))
HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; bet.xjack.tw updater)"}
NO_DATA = "很抱歉，沒有符合條件的資料!"
MAX_DAILY_MOVE = 0.25

# 證交所憑證缺 Subject Key Identifier，Python 3.13 起的嚴格模式會拒絕；
# 保留憑證驗證，只關掉嚴格模式這一項。
SSL_CTX = ssl.create_default_context()
SSL_CTX.verify_flags &= ~getattr(ssl, "VERIFY_X509_STRICT", 0)


def fail(msg):
    print(f"::error::{msg}")
    sys.exit(1)


def fetch_twse(url):
    last_err = None
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=30, context=SSL_CTX) as resp:
                payload = json.loads(resp.read().decode("utf-8"))
            time.sleep(3)  # 證交所有頻率限制
            if payload.get("stat") == "OK":
                return payload.get("data") or []
            if payload.get("stat") == NO_DATA:
                return []
            last_err = payload.get("stat")
        except Exception as e:  # noqa: BLE001
            last_err = e
        time.sleep(5 * (attempt + 1))
    fail(f"證交所 API 失敗：{url}（{last_err}）")


def roc_to_date(s):
    digits = s.replace("年", "/").replace("月", "/").replace("日", "").split("/")
    y, m, d = (int(x) for x in digits)
    return date(y + 1911, m, d)


def month_range(first, last):
    y, m = first.year, first.month
    while (y, m) <= (last.year, last.month):
        yield y, m
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)


def read_csv(path):
    with path.open(encoding="utf-8", newline="") as f:
        return list(csv.DictReader(f))


def write_csv(path, fieldnames, rows):
    with path.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames, lineterminator="\n")
        w.writeheader()
        w.writerows(rows)


def update_prices(cfg, codes, today):
    start = date.fromisoformat(cfg["start_date"])
    prices = {date.fromisoformat(r["date"]): {c: float(r[c]) for c in codes}
              for r in read_csv(DATA / "prices.csv")}
    last_known = max(prices)

    fetched = {c: {} for c in codes}
    for code in codes:
        for y, m in month_range(last_known, today):
            url = ("https://www.twse.com.tw/rwd/zh/afterTrading/STOCK_DAY"
                   f"?date={y}{m:02d}01&stockNo={code}&response=json")
            for row in fetch_twse(url):
                d = roc_to_date(row[0])
                if d <= start:
                    continue
                if "**" in (row[9] if len(row) > 9 else ""):
                    fail(f"{code} 在 {d} 有分割／反分割註記，需人工處理股數")
                close = row[6].replace(",", "")
                if close in ("--", ""):
                    continue
                fetched[code][d] = float(close)

    new_dates = sorted(set().union(*(fetched[c].keys() for c in codes)))
    for d in new_dates:
        missing = [c for c in codes if d not in fetched[c]]
        if missing:
            if d == new_dates[-1]:
                print(f"{d} 還缺 {missing} 的收盤價，下次再補")
                continue
            fail(f"{d} 缺 {missing} 的收盤價")
        prices[d] = {c: fetched[c][d] for c in codes}

    ordered = sorted(prices)
    for prev, cur in zip(ordered, ordered[1:]):
        for c in codes:
            move = prices[cur][c] / prices[prev][c] - 1
            if abs(move) > MAX_DAILY_MOVE:
                fail(f"{c} 在 {cur} 單日變動 {move:.1%}，超過 {MAX_DAILY_MOVE:.0%}，需人工確認")

    write_csv(DATA / "prices.csv", ["date", *codes],
              [{"date": d.isoformat(), **{c: f"{prices[d][c]:g}" for c in codes}} for d in ordered])
    return prices


def update_dividends(cfg, codes, today):
    start = date.fromisoformat(cfg["start_date"])
    divs = {(date.fromisoformat(r["ex_date"]), r["code"]): float(r["cash"])
            for r in read_csv(DATA / "dividends.csv")}

    since = max(start + timedelta(days=1), date(today.year - 1, 1, 1))
    rows = []
    if since <= today:
        url = ("https://www.twse.com.tw/rwd/zh/exRight/TWT49U"
               f"?startDate={since:%Y%m%d}&endDate={today:%Y%m%d}&response=json")
        rows = fetch_twse(url)
    for row in rows:
        code = row[1].strip()
        if code not in codes:
            continue
        ex_date = roc_to_date(row[0])
        if ex_date <= start:
            continue
        if row[6].strip() != "息":
            fail(f"{code} 在 {ex_date} 有「{row[6]}」（非純現金股利），需人工處理")
        divs[(ex_date, code)] = float(row[5])

    ordered = sorted(divs)
    write_csv(DATA / "dividends.csv", ["ex_date", "code", "cash"],
              [{"ex_date": d.isoformat(), "code": c, "cash": f"{divs[(d, c)]:g}"} for d, c in ordered])
    return divs


def compute(cfg, codes, prices, divs):
    start = date.fromisoformat(cfg["start_date"])
    capital, nav_base = cfg["capital"], cfg["nav_base"]
    units = {h["code"]: capital * h["weight"] / h["base_close"] for h in cfg["holdings"]}
    series = [[start.isoformat(), float(nav_base)]]
    applied = []
    last_price_date = max(prices)

    for (ex_date, code), cash in sorted(divs.items()):
        if ex_date not in prices and ex_date < last_price_date:
            fail(f"{code} 除息日 {ex_date} 沒有收盤價")

    for d in sorted(p for p in prices if p > start):
        for (ex_date, code), cash in sorted(divs.items()):
            if ex_date != d:
                continue
            close = prices[d][code]
            added = units[code] * cash / close
            units[code] += added
            applied.append({"ex_date": d.isoformat(), "code": code, "cash": cash,
                            "close": close, "added_units": round(added, 4),
                            "units_after": round(units[code], 4)})
        value = sum(units[c] * prices[d][c] for c in codes)
        series.append([d.isoformat(), round(value / capital * nav_base, 4)])

    last = max(prices)
    holdings = [{"code": h["code"], "name": h["name"], "weight": h["weight"],
                 "base_close": h["base_close"], "units": round(units[h["code"]], 4),
                 "last_close": prices[last][h["code"]]} for h in cfg["holdings"]]
    return {"as_of": last.isoformat(), "start_date": cfg["start_date"],
            "capital": capital, "nav_base": nav_base, "holdings": holdings,
            "dividends": applied, "series": series}


def dump(result):
    """series 一天一行、放最後，其他欄位正常縮排，diff 比較好讀。"""
    head = {k: v for k, v in result.items() if k != "series"}
    lines = [json.dumps(head, ensure_ascii=False, indent=1)[:-2] + ",", ' "series": [']
    lines.append(",\n".join("  " + json.dumps(p) for p in result["series"]))
    lines += [" ]", "}", ""]
    return "\n".join(lines)


def main():
    cfg = json.loads((DATA / "config.json").read_text(encoding="utf-8"))
    codes = [h["code"] for h in cfg["holdings"]]
    today = datetime.now(TPE).date()

    prices = update_prices(cfg, codes, today)
    divs = update_dividends(cfg, codes, today)
    result = compute(cfg, codes, prices, divs)

    out = DATA / "xjack.json"
    old = json.loads(out.read_text(encoding="utf-8")) if out.exists() else {}
    old.pop("updated_at", None)
    if old == result:
        print(f"沒有新資料（截至 {result['as_of']}）")
        return
    result["updated_at"] = datetime.now(TPE).isoformat(timespec="minutes")
    out.write_text(dump(result), encoding="utf-8")
    nav = result["series"][-1][1]
    print(f"更新到 {result['as_of']}：淨值 {nav}（累計 {nav / cfg['nav_base'] - 1:+.2%}）")


if __name__ == "__main__":
    main()
