#!/usr/bin/env bash
# Sprint 3 data seeding script
# Runs on EC2 against direct service ports (HRMS: 3012, Payroll: 3013)

set -euo pipefail

HRMS="http://127.0.0.1:3012"
PAYROLL="http://127.0.0.1:3013"

# Generate a fresh valid JWT
JWT=$(node -e "
const jwt = require('/home/ec2-user/CivitasOne/civitasone-suite/node_modules/.pnpm/jsonwebtoken@9.0.3/node_modules/jsonwebtoken');
const payload = {
  sub: 'seed-user-sprint3',
  tid: '00000000-0000-0000-0000-000000000001',
  tenantId: '00000000-0000-0000-0000-000000000001',
  roles: ['super_admin','hr_admin','payroll_admin','hr_staff','audit_admin','finance_admin','tenant_admin','dept_head','platform_admin'],
  iss: 'civitasone-dev',
  aud: 'civitasone',
  exp: Math.floor(Date.now()/1000) + 157680000
};
console.log(jwt.sign(payload, 'civitasone-dev-secret', {algorithm: 'HS256'}));
")

AUTH="Authorization: Bearer $JWT"
CT="Content-Type: application/json"

log() { echo "[$(date '+%H:%M:%S')] $*"; }
ok()  { echo "  OK: $*"; }
err() { echo "  ERR: $*" >&2; }

check_http() {
  local code
  code=$(echo "$1" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status','') or d.get('id','') or 'ok')" 2>/dev/null || echo "$1")
  echo "$code"
}

# ─────────────────────────────────────────────────────────────────────────────
# 1. PAY STRUCTURES  (Grade A, B, C)
# ─────────────────────────────────────────────────────────────────────────────
log "=== STEP 1: Pay Structures ==="

EXISTING_STRUCTURES=$(curl -sf "$PAYROLL/v1/payroll/structures" -H "$AUTH")
STRUCT_COUNT=$(echo "$EXISTING_STRUCTURES" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d))" 2>/dev/null || echo "0")
log "Existing structures: $STRUCT_COUNT"

STRUCT_A_ID=""
STRUCT_B_ID=""
STRUCT_C_ID=""

# Check if Grade A/B/C already exist
STRUCT_A_ID=$(echo "$EXISTING_STRUCTURES" | python3 -c "import sys,json; d=json.load(sys.stdin); r=[x['id'] for x in d if 'Grade A' in x.get('name','')]; print(r[0] if r else '')" 2>/dev/null || echo "")
STRUCT_B_ID=$(echo "$EXISTING_STRUCTURES" | python3 -c "import sys,json; d=json.load(sys.stdin); r=[x['id'] for x in d if 'Grade B' in x.get('name','')]; print(r[0] if r else '')" 2>/dev/null || echo "")
STRUCT_C_ID=$(echo "$EXISTING_STRUCTURES" | python3 -c "import sys,json; d=json.load(sys.stdin); r=[x['id'] for x in d if 'Grade C' in x.get('name','')]; print(r[0] if r else '')" 2>/dev/null || echo "")

if [ -z "$STRUCT_A_ID" ]; then
  RESP=$(curl -sf -X POST "$PAYROLL/v1/payroll/structures" \
    -H "$AUTH" -H "$CT" \
    -d '{"name":"Grade A Pay Structure","description":"Basic 80000, DA 40%, HRA 27%, TA 3200 — Senior Officer Grade","isDefault":false}')
  STRUCT_A_ID=$(echo "$RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null || echo "")
  ok "Created Grade A structure: $STRUCT_A_ID"
  sleep 2
else
  ok "Grade A structure already exists: $STRUCT_A_ID"
fi

if [ -z "$STRUCT_B_ID" ]; then
  RESP=$(curl -sf -X POST "$PAYROLL/v1/payroll/structures" \
    -H "$AUTH" -H "$CT" \
    -d '{"name":"Grade B Pay Structure","description":"Basic 50000, DA 40%, HRA 24%, TA 2400 — Middle Officer Grade","isDefault":false}')
  STRUCT_B_ID=$(echo "$RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null || echo "")
  ok "Created Grade B structure: $STRUCT_B_ID"
  sleep 2
else
  ok "Grade B structure already exists: $STRUCT_B_ID"
fi

if [ -z "$STRUCT_C_ID" ]; then
  RESP=$(curl -sf -X POST "$PAYROLL/v1/payroll/structures" \
    -H "$AUTH" -H "$CT" \
    -d '{"name":"Grade C Pay Structure","description":"Basic 30000, DA 40%, HRA 20%, TA 1800 — Junior Staff Grade","isDefault":false}')
  STRUCT_C_ID=$(echo "$RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null || echo "")
  ok "Created Grade C structure: $STRUCT_C_ID"
  sleep 2
else
  ok "Grade C structure already exists: $STRUCT_C_ID"
fi

# Wait for worker to process structure creates
sleep 4

# Re-fetch to get committed UUIDs
STRUCT_AFTER=$(curl -sf "$PAYROLL/v1/payroll/structures" -H "$AUTH")
log "Structures after creation: $(echo "$STRUCT_AFTER" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null)"

# Get a committed structure ID for the payroll run (use Grade A or first available)
RUN_STRUCT_ID=$(echo "$STRUCT_AFTER" | python3 -c "
import sys,json
d=json.load(sys.stdin)
# prefer Grade A, else first
r=[x['id'] for x in d if 'Grade A' in x.get('name','')]
if r: print(r[0])
elif d: print(d[0]['id'])
else: print('')
" 2>/dev/null || echo "")

if [ -z "$RUN_STRUCT_ID" ]; then
  err "No structure available for payroll run. Using fallback UUID."
  RUN_STRUCT_ID="ffffffff-0000-0000-0000-000000000001"
fi
log "Using structure $RUN_STRUCT_ID for payroll run"

# ─────────────────────────────────────────────────────────────────────────────
# 2. PAYROLL RUN — July 2026
# ─────────────────────────────────────────────────────────────────────────────
log "=== STEP 2: Payroll Run July 2026 ==="

EXISTING_RUNS=$(curl -sf "$PAYROLL/v1/payroll/runs" -H "$AUTH")
JUL_RUN=$(echo "$EXISTING_RUNS" | python3 -c "
import sys,json
d=json.load(sys.stdin)
r=[x for x in d.get('data',[]) if x.get('payPeriod','')=='2026-07']
print(r[0]['id'] if r else '')
" 2>/dev/null || echo "")

if [ -z "$JUL_RUN" ]; then
  RESP=$(curl -sf -X POST "$PAYROLL/v1/payroll/runs" \
    -H "$AUTH" -H "$CT" \
    -d "{\"runNo\":\"RUN-2026-07-001\",\"month\":\"2026-07\",\"structureId\":\"$RUN_STRUCT_ID\",\"runType\":\"regular\"}")
  RUN_ID=$(echo "$RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null || echo "")
  ok "Created July 2026 payroll run: $RUN_ID"
else
  RUN_ID="$JUL_RUN"
  ok "July 2026 run already exists: $RUN_ID"
fi

# ─────────────────────────────────────────────────────────────────────────────
# 3. TRAINING PROGRAMS
# ─────────────────────────────────────────────────────────────────────────────
log "=== STEP 3: Training Programs ==="

EXISTING_TRAININGS=$(curl -sf "$HRMS/v1/hrms/training-programs?limit=50" -H "$AUTH")
TRAIN_COUNT=$(echo "$EXISTING_TRAININGS" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('data',[])))" 2>/dev/null || echo "0")
log "Existing training programs: $TRAIN_COUNT"

declare -A TRAINING_TITLES=(
  ["Leadership & Governance"]="LG"
  ["Digital Literacy for Government Officials"]="DL"
  ["RTI Act Compliance Training"]="RTI"
  ["DPDP Act Awareness Programme"]="DPDP"
  ["Anti-Corruption Policy & Ethics"]="AC"
)

TRAINING_IDS=()
for TITLE in "Leadership & Governance" "Digital Literacy for Government Officials" "RTI Act Compliance Training" "DPDP Act Awareness Programme" "Anti-Corruption Policy & Ethics"; do
  EXISTING_ID=$(echo "$EXISTING_TRAININGS" | python3 -c "
import sys,json
d=json.load(sys.stdin)
r=[x['id'] for x in d.get('data',[]) if '$TITLE' in x.get('title','')]
print(r[0] if r else '')
" 2>/dev/null || echo "")

  if [ -z "$EXISTING_ID" ]; then
    RESP=$(curl -sf -X POST "$HRMS/v1/hrms/trainings" \
      -H "$AUTH" -H "$CT" \
      -d "{\"title\":\"$TITLE\",\"venue\":\"NICSI Training Centre, New Delhi\",\"fromDate\":\"2026-09-01\",\"toDate\":\"2026-09-05\",\"facilitator\":\"National Institute for Smart Government\",\"maxParticipants\":30}")
    TID=$(echo "$RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null || echo "")
    ok "Created training '$TITLE': $TID"
    TRAINING_IDS+=("$TID")
    sleep 1
  else
    ok "Training '$TITLE' already exists: $EXISTING_ID"
    TRAINING_IDS+=("$EXISTING_ID")
  fi
done

# Wait for hrms worker to commit
sleep 3

# ─────────────────────────────────────────────────────────────────────────────
# 4. APPRAISAL CYCLES  (3 cycles)
# ─────────────────────────────────────────────────────────────────────────────
log "=== STEP 4: Appraisal Cycles ==="

EXISTING_APPRAISALS=$(curl -sf "$HRMS/v1/hrms/appraisals?limit=50" -H "$AUTH")
APR_COUNT=$(echo "$EXISTING_APPRAISALS" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('data',[])))" 2>/dev/null || echo "0")
log "Existing appraisals: $APR_COUNT"

# Use first 3 employee IDs for representative appraisals
EMP1="a549f454-0378-4144-b1bc-9ea5ef820034"
EMP2="ff17e68a-4266-4f2b-8415-5489a14fc2f0"
EMP3="ac48127b-0119-487d-afe1-3e1e5da69090"

for PERIOD in "FY2024-25" "FY2025-26" "FY2026-27"; do
  for EMP in "$EMP1" "$EMP2" "$EMP3"; do
    EXISTING=$(echo "$EXISTING_APPRAISALS" | python3 -c "
import sys,json
d=json.load(sys.stdin)
r=[x for x in d.get('data',[]) if x.get('appraisalPeriod','')=='$PERIOD' and x.get('employeeId','')=='$EMP']
print(r[0]['id'] if r else '')
" 2>/dev/null || echo "")

    if [ -z "$EXISTING" ]; then
      RESP=$(curl -sf -X POST "$HRMS/v1/hrms/appraisals" \
        -H "$AUTH" -H "$CT" \
        -d "{\"employeeId\":\"$EMP\",\"appraisalPeriod\":\"$PERIOD\"}")
      AID=$(echo "$RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null || echo "")
      ok "Created appraisal $PERIOD for $EMP: $AID"
      sleep 0.5
    else
      ok "Appraisal $PERIOD/$EMP already exists"
    fi
  done
done

sleep 3

# ─────────────────────────────────────────────────────────────────────────────
# 5. TRANSFER ORDERS  (10 transfers)
# ─────────────────────────────────────────────────────────────────────────────
log "=== STEP 5: Transfer Orders ==="

EXISTING_TRANSFERS=$(curl -sf "$HRMS/v1/hrms/lifecycle/transfers" -H "$AUTH")
TX_COUNT=$(echo "$EXISTING_TRANSFERS" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('data',[])))" 2>/dev/null || echo "0")
log "Existing transfers: $TX_COUNT"

# Department IDs
DEPT_HR="78d1c3e0-9442-4651-b9cc-bea796ac71fa"
DEPT_FIN="30b87697-503a-45fb-b552-79560bbfabf8"
DEPT_IT="2a0d89d6-20d2-4d0d-a6e1-2336d6d03bfd"
DEPT_ADM="278f880c-d5f4-4291-b2c5-70b8de3256e7"
DEPT_ENG="f14c41fc-5ecb-487a-9167-86f5aad3c5cb"
DEPT_LEG="67d030d2-3516-4d27-9bc1-d95da51125fe"

# Employee IDs (10 for transfers)
TRANSFER_EMPS=(
  "34dc5246-e9fd-4ad2-8584-43038203a724"
  "454972ae-4338-40f6-bf6a-34c39dfe0154"
  "316c6016-b538-4513-91cb-5591f5f88ce0"
  "ae6dd372-2800-42c5-bbc5-004f5ba7b6e7"
  "a680540b-393b-4427-8afd-017f4ae67918"
  "e558761a-a3b4-4f36-b819-bd452f9c6b53"
  "90916cff-4189-4bc0-9f34-93d55690e607"
  "3415a95e-34b0-4351-88b8-6a7182df14b3"
  "3fd80963-caa5-4586-8030-9eff3f96cd6c"
  "093a21bb-9b83-4ad8-afa6-173147f4d292"
)

TRANSFER_PAIRS=(
  "$DEPT_HR:$DEPT_FIN"
  "$DEPT_FIN:$DEPT_IT"
  "$DEPT_IT:$DEPT_ADM"
  "$DEPT_ADM:$DEPT_ENG"
  "$DEPT_ENG:$DEPT_LEG"
  "$DEPT_LEG:$DEPT_HR"
  "$DEPT_HR:$DEPT_IT"
  "$DEPT_FIN:$DEPT_ADM"
  "$DEPT_ADM:$DEPT_LEG"
  "$DEPT_ENG:$DEPT_FIN"
)

i=0
for EMP in "${TRANSFER_EMPS[@]}"; do
  PAIR="${TRANSFER_PAIRS[$i]}"
  FROM_DEPT="${PAIR%%:*}"
  TO_DEPT="${PAIR##*:}"
  ORDER_REF="TO/2026-27/$(printf '%03d' $((i+1)))"
  EFFECTIVE="2026-08-$(printf '%02d' $((i+1)))"

  EXISTING=$(echo "$EXISTING_TRANSFERS" | python3 -c "
import sys,json
d=json.load(sys.stdin)
r=[x for x in d.get('data',[]) if x.get('employeeId','')=='$EMP']
print(r[0]['id'] if r else '')
" 2>/dev/null || echo "")

  if [ -z "$EXISTING" ]; then
    RESP=$(curl -sf -X POST "$HRMS/v1/hrms/lifecycle/transfers" \
      -H "$AUTH" -H "$CT" \
      -d "{\"employeeId\":\"$EMP\",\"fromDeptId\":\"$FROM_DEPT\",\"toDeptId\":\"$TO_DEPT\",\"effectiveDate\":\"$EFFECTIVE\",\"orderRef\":\"$ORDER_REF\",\"fromStation\":\"Head Office\",\"toStation\":\"District Office\"}")
    TXN_ID=$(echo "$RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null || echo "")
    ok "Transfer $((i+1))/10 for $EMP: $TXN_ID"
    sleep 0.5
  else
    ok "Transfer for $EMP already exists: $EXISTING"
  fi
  i=$((i+1))
done

sleep 3

# ─────────────────────────────────────────────────────────────────────────────
# 6. PROMOTIONS  (5 promotions)
# ─────────────────────────────────────────────────────────────────────────────
log "=== STEP 6: Promotions ==="

DESIG_HRD="687027a0-56f0-4918-a45d-15f92c0f486f"   # HR Director level 8
DESIG_HRM="d8da15ec-0cbc-4322-a22a-91e4f06b457e"   # HR Manager level 6
DESIG_HRO="87b75dec-264e-4544-86ad-ab91226b3854"   # HR Officer level 4
DESIG_JE="7e4bf100-56a3-4f67-bcf6-9cb1934810c9"    # Junior Engineer level 5
DESIG_ADDLSECY="61e4593a-05e6-4c80-ab21-2dfb621e858f" # Addl Secretary level 15

PROMO_EMPS=(
  "f25fd715-8738-4ace-84d5-bcac4dd8ca4b:$DESIG_HRO:$DESIG_HRM"
  "a04c1df6-15c4-496c-9db8-44399cf3c95c:$DESIG_HRM:$DESIG_HRD"
  "0f1f25ee-6104-4011-bec9-38162615044e:$DESIG_HRO:$DESIG_HRM"
  "77831cd1-ba88-4c34-9e06-f2079289494e:$DESIG_JE:$DESIG_HRO"
  "7d0747fe-efaf-4eef-a312-50f04e650cd7:$DESIG_HRM:$DESIG_HRD"
)

EXISTING_PROMOTIONS=$(curl -sf "$HRMS/v1/hrms/lifecycle/promotions" -H "$AUTH")
PROMO_COUNT=$(echo "$EXISTING_PROMOTIONS" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('data',[])))" 2>/dev/null || echo "0")
log "Existing promotions: $PROMO_COUNT"

j=0
for PROMO in "${PROMO_EMPS[@]}"; do
  EMP="${PROMO%%:*}"
  REST="${PROMO#*:}"
  FROM_DESIG="${REST%%:*}"
  TO_DESIG="${REST##*:}"
  EFFECTIVE="2026-07-$(printf '%02d' $((j+1)))"
  ORDER_REF="PROMO/2026-27/$(printf '%03d' $((j+1)))"

  EXISTING=$(echo "$EXISTING_PROMOTIONS" | python3 -c "
import sys,json
d=json.load(sys.stdin)
r=[x for x in d.get('data',[]) if x.get('employeeId','')=='$EMP']
print(r[0]['id'] if r else '')
" 2>/dev/null || echo "")

  if [ -z "$EXISTING" ]; then
    RESP=$(curl -sf -X POST "$HRMS/v1/hrms/lifecycle/promotions" \
      -H "$AUTH" -H "$CT" \
      -d "{\"employeeId\":\"$EMP\",\"fromDesigId\":\"$FROM_DESIG\",\"toDesigId\":\"$TO_DESIG\",\"effectiveDate\":\"$EFFECTIVE\",\"orderRef\":\"$ORDER_REF\",\"newBasicMinor\":5500000}")
    PID=$(echo "$RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null || echo "")
    ok "Promotion $((j+1))/5 for $EMP: $PID"
    sleep 0.5
  else
    ok "Promotion for $EMP already exists: $EXISTING"
  fi
  j=$((j+1))
done

sleep 3

# ─────────────────────────────────────────────────────────────────────────────
# VERIFICATION
# ─────────────────────────────────────────────────────────────────────────────
log "=== VERIFICATION ==="

STRUCT_FINAL=$(curl -sf "$PAYROLL/v1/payroll/structures" -H "$AUTH")
STRUCT_FINAL_COUNT=$(echo "$STRUCT_FINAL" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")

RUNS_FINAL=$(curl -sf "$PAYROLL/v1/payroll/runs" -H "$AUTH")
RUNS_FINAL_COUNT=$(echo "$RUNS_FINAL" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('data',[])))" 2>/dev/null || echo "0")

TRAININGS_FINAL=$(curl -sf "$HRMS/v1/hrms/training-programs?limit=50" -H "$AUTH")
TRAININGS_FINAL_COUNT=$(echo "$TRAININGS_FINAL" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('data',[])))" 2>/dev/null || echo "0")

APPRAISALS_FINAL=$(curl -sf "$HRMS/v1/hrms/appraisals?limit=100" -H "$AUTH")
APPRAISALS_FINAL_COUNT=$(echo "$APPRAISALS_FINAL" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('data',[])))" 2>/dev/null || echo "0")

TRANSFERS_FINAL=$(curl -sf "$HRMS/v1/hrms/lifecycle/transfers" -H "$AUTH")
TRANSFERS_FINAL_COUNT=$(echo "$TRANSFERS_FINAL" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('data',[])))" 2>/dev/null || echo "0")

PROMOS_FINAL=$(curl -sf "$HRMS/v1/hrms/lifecycle/promotions" -H "$AUTH")
PROMOS_FINAL_COUNT=$(echo "$PROMOS_FINAL" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('data',[])))" 2>/dev/null || echo "0")

echo ""
echo "============================================"
echo "  SPRINT 3 SEED VERIFICATION SUMMARY"
echo "============================================"
echo "  Pay Structures   : $STRUCT_FINAL_COUNT"
echo "  Payroll Runs     : $RUNS_FINAL_COUNT"
echo "  Training Programs: $TRAININGS_FINAL_COUNT"
echo "  Appraisals       : $APPRAISALS_FINAL_COUNT"
echo "  Transfers        : $TRANSFERS_FINAL_COUNT"
echo "  Promotions       : $PROMOS_FINAL_COUNT"
echo "============================================"
echo "DONE"
