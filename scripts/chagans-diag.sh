#!/bin/bash
cd ~/paybridgex || exit 1
val() { grep -E "^$1=" .env | head -1 | cut -d= -f2- | tr -d '\r' | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//"; }
CID=$(val CHAGAN_CLIENT_ID); CSEC=$(val CHAGAN_CLIENT_SECRET); TOK=$(val CHAGAN_API_TOKEN)
BASE=$(val CHAGAN_BASE_URL); BASE=${BASE:-https://chagans.com}

test_tx() {
  local label="$1" amt="$2" pg="$3" mode="$4"
  local tid="PBXTEST$(date +%s%N | cut -c1-15)"
  echo "===================================================================="
  echo "$label"
  echo "  amount=$amt  pgType=$pg  mode=$mode  txnId=$tid"
  echo "  full response:"
  curl -sS -X POST "$BASE/partnerPg/payRequest" \
    -H "Content-Type: application/json" \
    -H "client-id: $CID" -H "client-secret: $CSEC" -H "Authorization: Bearer $TOK" \
    --max-time 25 \
    -w "\n  [http_code=%{http_code} time=%{time_total}s]\n" \
    -d '{"amount":'"$amt"',"pgType":"'"$pg"'","txnId":"'"$tid"'","mode":"'"$mode"'","callback":"https://paybridgex.in/pay/return?ref='"$tid"'","webhook":"https://paybridgex.in/api/webhooks/chagans-pg","name":"Ramesh Kumar","mobile":"9826512345","email":"ramesh.kumar@gmail.com"}'
  echo
  sleep 1
}

echo "egress IP: $(curl -s https://api.ipify.org)"
echo
# A: structurally identical request, amount is a multiple of 100 -> caught by THEIR validation (proves request is well-formed and parsed)
test_tx "A) CONTROL — amount IS multiple of 100 (expect their validation error)" 500 chagans3 t1
# B: same request, a normal payable amount -> passes validation, goes downstream
test_tx "B) REAL TEST — payable amount 149 (Comet)" 149 chagans3 t1
# C: a different payable amount on Star
test_tx "C) REAL TEST — payable amount 149 (Star)"  149 chagans2 t0
echo "=== done ==="
