# 跟岳母的十年之約

https://bet.xjack.tw

岳母 aka 波段操作派，對上我 aka 大盤市值仔。各拿 100 萬，2026/10/1 開打，每半年比一次報酬率，連續比十年。

## 資料怎麼來

| 檔案 | 內容 | 誰更新 |
|---|---|---|
| `data/config.json` | 我的起算日、配置、起算收盤價 | 開賽時寫定，不再改 |
| `data/prices.csv` | 0050、009826 每日收盤價（臺灣證券交易所） | GitHub Actions，每個交易日 15:30 |
| `data/dividends.csv` | 除息紀錄（臺灣證券交易所除權除息計算結果表） | 同上 |
| `data/xjack.json` | 我的每日淨值與持股（網頁讀這個） | 同上，由 `scripts/update_xjack.py` 產生 |
| `data/settlements.json` | 每局結算：雙方淨值 | 每局結算時手動填 |

遇到腳本沒辦法自動處理的狀況（ETF 分割、股票股利、單日漲跌超過 25%、缺價），Actions 會直接失敗，網站停在上一次的正確資料，等人工處理。

## 瀏覽人次

`counter/` 是 Cloudflare Worker＋D1，網址 `https://bet-api.xjack.tw/views`（GET 讀、POST +1，POST 只收 bet.xjack.tw 來源）。只存一個數字，不記 IP 或個人資料。同一個分頁工作階段只算一次。

## 場邊押注

網頁上讓大家猜每一局誰贏，純好玩、不用錢、沒有獎品。跟瀏覽人次共用同一個 Worker＋D1：

- `GET https://bet-api.xjack.tw/bets`：目前開放下注的局（`open`）、各局押岳母／叉傑克的人數（`rounds`）。
- `POST /bets`，內容 `{"round":1,"side":"mil|me","token":"..."}`：押一注，只收 bet.xjack.tw 來源。
- 每局下注到該局結算日 13:30（收盤）截止，截止後自動開放下一局；第 20 局截止後就不能再押。
- 同一個裝置（瀏覽器自己產生的隨機 token）每局一注，押了不能改。
- 同一個連線來源每局最多 20 注，擋有人狂灌。來源只存「祕密鹽＋局數＋IP（IPv6 取 /64）」的雜湊，每局換鹽，無法還原成 IP；祕密鹽放在 Worker secret `BET_SALT`。
- 逐筆紀錄在 `bets` 表，各局人數另存在 `counters`（`bet:<局>:<mil|me>`），網頁讀人數不必掃全表。
- 誰贏照 `data/settlements.json` 判斷，所以結算時不用另外處理押注，填好淨值、紀錄表就會顯示「岳母勝／叉傑克勝」和押中比例。

## 部署 Worker

在 `counter/` 執行（要先 `npx wrangler login`）：

1. 第一次或 schema 有改：`npx wrangler d1 execute bet-counter --remote --file schema.sql`（全部是 `IF NOT EXISTS`，重跑不會動到資料）
2. 第一次：`npx wrangler secret put BET_SALT`（貼一串隨機字，之後不要換，換了同來源上限會重算）
3. `npx wrangler deploy`

本機測試：`npx wrangler dev --var BET_SALT:devsalt --var DEV_ORIGIN:http://localhost:8000`，網頁從 `http://localhost:8000` 開就會接到本機 Worker；要模擬別的時間點可再加 `--var DEV_NOW:2027-07-02T00:00:00Z`。

## 每局結算

1. 在 `data/settlements.json` 該局填入 `settled_on`（實際結算交易日）、`xjack_nav`（我那天的淨值，從 `data/xjack.json` 抄）、`mil_nav`（岳母的淨值）、`post_url`（粉專結算文網址）。
2. push 到 `main`，網站自動重新部署。

兩個淨值都有值，那一局才算完賽，比數板才會亮燈。

## 計算方式

兩邊都用淨值法，100 萬本金等於每單位 10 元。岳母中途有存提款就換算成單位數增減，所以資金進出不影響成績。

我這邊是試算帳本：買整股、手續費 0.1425%（最低 20 元）、零頭留現金、台幣計到元捨去；配息在除息日買回同一檔；每年第一個交易日再平衡回 70/30（賣出另扣 0.1% 證交稅），第一次在 2028 年初。完整規則寫在網站「怎麼比」那一段。

這不是投資建議，只是公開記錄一個真實的實驗。
