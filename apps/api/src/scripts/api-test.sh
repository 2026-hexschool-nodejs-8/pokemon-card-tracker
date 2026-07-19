#!/usr/bin/env bash
# API smoke test：手動驗證流程固化版。
# 前置條件：docker compose up -d db、npm run db:migrate、npm run db:seed、npm run dev:api 都已在跑。
# 腳本只負責驗證，不負責啟動環境。
set -uo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@pct.local}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-admin1234}"

PASS=0
FAIL=0
TMP=$(mktemp)
trap 'rm -f "$TMP"' EXIT

assert_status() {
  local desc="$1" expected="$2" actual="$3"
  if [[ "$actual" == "$expected" ]]; then
    echo "✅ $desc (status $actual)"; PASS=$((PASS+1))
  else
    echo "❌ $desc (expected $expected, got $actual)"; FAIL=$((FAIL+1))
  fi
}
json() { node -pe "JSON.parse(require('fs').readFileSync(0,'utf8'))$1" 2>/dev/null; }

# --- health ---
STATUS=$(curl -s -o "$TMP" -w '%{http_code}' "$BASE_URL/health")
assert_status "GET /health" 200 "$STATUS"

# --- public cards ---
STATUS=$(curl -s -o "$TMP" -w '%{http_code}' "$BASE_URL/cards")
assert_status "GET /cards" 200 "$STATUS"

# --- admin auth ---
STATUS=$(curl -s -o "$TMP" -w '%{http_code}' -X POST "$BASE_URL/admin/auth/login" \
  -H 'Content-Type: application/json' -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"wrong\"}")
assert_status "POST /admin/auth/login 密碼錯誤" 401 "$STATUS"

LOGIN=$(curl -s -X POST "$BASE_URL/admin/auth/login" \
  -H 'Content-Type: application/json' -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}")
TOKEN=$(echo "$LOGIN" | json '.token')
if [[ -z "$TOKEN" || "$TOKEN" == "undefined" ]]; then
  echo "❌ 登入失敗，中止：$LOGIN"; exit 1
fi
echo "✅ 登入取得 token"; PASS=$((PASS+1))
AUTH=(-H "Authorization: Bearer $TOKEN")

STATUS=$(curl -s -o "$TMP" -w '%{http_code}' "$BASE_URL/admin/cards")
assert_status "GET /admin/cards 無 token" 401 "$STATUS"

# --- admin cards/sources CRUD ---
CREATE=$(curl -s -X POST "$BASE_URL/admin/cards" "${AUTH[@]}" -H 'Content-Type: application/json' \
  -d '{"name":"smoke-test 卡牌","cardNumber":"SMOKE-001","language":"ja"}')
CARD_ID=$(echo "$CREATE" | json '.data.id')
[[ -n "$CARD_ID" && "$CARD_ID" != "undefined" ]] \
  && { echo "✅ 建立測試卡 $CARD_ID"; PASS=$((PASS+1)); } \
  || { echo "❌ 建立卡牌失敗：$CREATE"; FAIL=$((FAIL+1)); exit 1; }

STATUS=$(curl -s -o "$TMP" -w '%{http_code}' -X POST "$BASE_URL/admin/cards" "${AUTH[@]}" \
  -H 'Content-Type: application/json' -d '{"language":"ja"}')
assert_status "POST /admin/cards 缺必填欄位" 400 "$STATUS"

SRC=$(curl -s -X POST "$BASE_URL/admin/cards/$CARD_ID/sources" "${AUTH[@]}" \
  -H 'Content-Type: application/json' -d '{"type":"api","provider":"mockApi","externalId":"smoke-src","currency":"JPY"}')
SOURCE_ID=$(echo "$SRC" | json '.data.id')
[[ -n "$SOURCE_ID" && "$SOURCE_ID" != "undefined" ]] \
  && { echo "✅ 建立來源 $SOURCE_ID"; PASS=$((PASS+1)); } \
  || { echo "❌ 建立來源失敗：$SRC"; FAIL=$((FAIL+1)); }

# --- price-sync：成功情境 ---
JOB=$(curl -s -X POST "$BASE_URL/admin/cards/$CARD_ID/price-sync" "${AUTH[@]}")
JOB_STATUS=$(echo "$JOB" | json '.data.status')
[[ "$JOB_STATUS" == "success" ]] \
  && { echo "✅ price-sync 成功情境"; PASS=$((PASS+1)); } \
  || { echo "❌ price-sync 預期 success，實際 $JOB_STATUS"; FAIL=$((FAIL+1)); }

# --- price-sync：失敗情境（externalId 帶 fail 觸發 mock 失敗） ---
FAIL_CARD=$(curl -s -X POST "$BASE_URL/admin/cards" "${AUTH[@]}" -H 'Content-Type: application/json' \
  -d '{"name":"smoke-test 失敗卡","cardNumber":"SMOKE-FAIL-001","language":"ja"}')
FAIL_CARD_ID=$(echo "$FAIL_CARD" | json '.data.id')
curl -s -X POST "$BASE_URL/admin/cards/$FAIL_CARD_ID/sources" "${AUTH[@]}" -H 'Content-Type: application/json' \
  -d '{"type":"api","provider":"mockApi","externalId":"fail-source","currency":"JPY"}' > /dev/null
FAIL_JOB=$(curl -s -X POST "$BASE_URL/admin/cards/$FAIL_CARD_ID/price-sync" "${AUTH[@]}")
FAIL_JOB_STATUS=$(echo "$FAIL_JOB" | json '.data.status')
[[ "$FAIL_JOB_STATUS" == "failed" ]] \
  && { echo "✅ price-sync 失敗情境符合預期"; PASS=$((PASS+1)); } \
  || { echo "❌ price-sync 預期 failed，實際 $FAIL_JOB_STATUS"; FAIL=$((FAIL+1)); }

# --- 軟刪除 -> 公開 404 -> PATCH 復原 -> 公開 200 ---
curl -s -X DELETE "$BASE_URL/admin/cards/$CARD_ID" "${AUTH[@]}" > /dev/null
STATUS=$(curl -s -o "$TMP" -w '%{http_code}' "$BASE_URL/cards/$CARD_ID")
assert_status "軟刪除後 public GET /cards/:id" 404 "$STATUS"

curl -s -X PATCH "$BASE_URL/admin/cards/$CARD_ID" "${AUTH[@]}" \
  -H 'Content-Type: application/json' -d '{"isActive":true}' > /dev/null
STATUS=$(curl -s -o "$TMP" -w '%{http_code}' "$BASE_URL/cards/$CARD_ID")
assert_status "PATCH isActive:true 復原後 public GET /cards/:id" 200 "$STATUS"

# --- 清乾淨測試資料（硬刪除，不留殘留資料）---
# 假設 DELETE /admin/cards/:id?hard=true 會連同 sources/snapshots 一併刪除
STATUS=$(curl -s -o "$TMP" -w '%{http_code}' -X DELETE "$BASE_URL/admin/cards/$CARD_ID?hard=true" "${AUTH[@]}")
assert_status "硬刪除測試卡 $CARD_ID" 200 "$STATUS"

STATUS=$(curl -s -o "$TMP" -w '%{http_code}' -X DELETE "$BASE_URL/admin/cards/$FAIL_CARD_ID?hard=true" "${AUTH[@]}")
assert_status "硬刪除測試卡 $FAIL_CARD_ID" 200 "$STATUS"

echo
echo "==================== 結果 ===================="
echo "PASS: $PASS  FAIL: $FAIL"
[[ "$FAIL" -eq 0 ]]
