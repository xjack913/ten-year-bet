-- 計數：瀏覽人次（name = 'bet'）、各局押注人數（name = 'bet:<局>:<mil|me>'）
CREATE TABLE IF NOT EXISTS counters (
  name TEXT PRIMARY KEY,
  value INTEGER NOT NULL DEFAULT 0
);

-- 場邊押注的逐筆紀錄：同一個裝置（token）每局只能一筆
-- src 是連線來源的加鹽雜湊（每局換鹽，無法還原成 IP），只用來限制同一來源的注數
CREATE TABLE IF NOT EXISTS bets (
  round INTEGER NOT NULL,
  token TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('mil', 'me')),
  src TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (round, token)
);
CREATE INDEX IF NOT EXISTS bets_round_src ON bets (round, src);
