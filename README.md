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

部署：在 `counter/` 執行 `npx wrangler deploy`（要先 `npx wrangler login`）。

## 每局結算

1. 在 `data/settlements.json` 該局填入 `settled_on`（實際結算交易日）、`xjack_nav`（我那天的淨值，從 `data/xjack.json` 抄）、`mil_nav`（岳母的淨值）、`post_url`（粉專結算文網址）。
2. push 到 `main`，網站自動重新部署。

兩個淨值都有值，那一局才算完賽，比數板才會亮燈。

## 計算方式

兩邊都用淨值法，100 萬本金等於每單位 10 元。岳母中途有存提款就換算成單位數增減，所以資金進出不影響成績。

我這邊是試算帳本：買整股、手續費 0.1425%（最低 20 元）、零頭留現金、台幣計到元捨去；配息在除息日買回同一檔；每年第一個交易日再平衡回 70/30（賣出另扣 0.1% 證交稅），第一次在 2028 年初。完整規則寫在網站「怎麼比」那一段。

這不是投資建議，只是公開記錄一個真實的實驗。
