#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# 큐브티 — 인스턴스 기능 점검(스모크 테스트)
#
#   ./smoke-test.sh --code acme      # 고객사 인스턴스
#   ./smoke-test.sh --direct         # 직영(cubetee.co.kr)
#
# 업데이트 직후 "화면이 실제로 멀쩡한지"를 사람 대신 확인한다.
# /login 200 만 보는 헬스체크는 "서버가 살아있다"까지만 증명한다 —
# 그 뒤에 있는 화면들이 500 을 내도 헬스체크는 통과한다.
#
# ⚠ 읽기만 한다. 운영 데이터를 만들지도 지우지도 않는다.
#   비밀번호도 필요 없다 — 컨테이너 안에서 관리자 토큰을 직접 발급해 쓴다.
# ─────────────────────────────────────────────────────────────
set -uo pipefail

CODE=""; DIRECT=0; VERBOSE=0
BASE_DIR="${CUBETEE_BASE_DIR:-/opt/cubetee/customers}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --code)    CODE="$2"; shift 2 ;;
    --direct)  DIRECT=1;  shift ;;
    -v|--verbose) VERBOSE=1; shift ;;
    -h|--help) sed -n '2,14p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "알 수 없는 옵션: $1" >&2; exit 1 ;;
  esac
done

die() { echo "✗ $*" >&2; exit 1; }

# ── 대상 결정 ────────────────────────────────────────────────
if [[ $DIRECT -eq 1 ]]; then
  WEB="qubetee-web-1"; PORT=3000; LABEL="직영"
elif [[ -n "$CODE" ]]; then
  DIR="$BASE_DIR/$CODE"
  [[ -d "$DIR" ]] || die "그런 고객사가 없습니다: $CODE"
  PORT="$(grep -E '^WEB_PORT=' "$DIR/.env" | head -1 | cut -d= -f2-)"
  WEB="cubetee-${CODE}-web-1"; LABEL="$CODE"
else
  die "--code <코드> 또는 --direct 가 필요하다"
fi

docker ps --format '{{.Names}}' | grep -qx "$WEB" || die "웹 컨테이너가 없습니다: $WEB"
BASE="http://127.0.0.1:$PORT"

echo "════════════════════════════════════════════════════════════"
echo "  기능 점검 — $LABEL  ($BASE)"
echo "════════════════════════════════════════════════════════════"

PASS=0; FAIL=0; FAILED_LIST=""

check() {  # check <이름> <기대코드> <실제코드> [부가설명]
  local name="$1" want="$2" got="$3" extra="${4:-}"
  if [[ "$got" == "$want" ]]; then
    printf "  ✓ %-34s %s %s\n" "$name" "$got" "$extra"
    PASS=$((PASS+1))
  else
    printf "  ✗ %-34s %s (기대 %s) %s\n" "$name" "$got" "$want" "$extra"
    FAIL=$((FAIL+1)); FAILED_LIST="$FAILED_LIST $name"
  fi
}

code_of() { curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$@" 2>/dev/null || echo "000"; }
# 페이지는 리다이렉트를 따라간 최종 코드를 본다.
# (/work → /work/chat 처럼 정상 리다이렉트를 실패로 잡지 않도록)
page_code_of() { curl -sL -o /dev/null -w '%{http_code}' --max-time 20 "$@" 2>/dev/null || echo "000"; }

# ── 1) 인증 경로 ─────────────────────────────────────────────
echo
echo "▸ 인증"
# 토큰 없이 보호된 API → 401 이어야 한다. 200 이 오면 인증이 뚫린 것이다.
check "토큰 없이 직원목록(차단되나)" "401" "$(code_of "$BASE/api/employees")"
# 틀린 비밀번호 → 401. 로그인 로직이 살아있는지 본다(계정을 만들지 않는다)
WRONG=$(code_of -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' \
        -d '{"email":"smoke-test-not-exist@example.invalid","password":"wrong"}')
check "잘못된 로그인(거부되나)" "401" "$WRONG"

# ── 2) 관리자 토큰 발급 ──────────────────────────────────────
# 컨테이너 안에서 직접 서명한다. 비밀번호를 몰라도 되고 운영 계정도 건드리지 않는다.
ADMIN_ID="$(docker exec "$WEB" sh -c 'cd /app/apps/web && node -e "
const {PrismaClient}=require(\"@prisma/client\");const p=new PrismaClient();
p.user.findFirst({where:{role:\"ADMIN\",isActive:true},select:{id:true}}).then(u=>{
  console.log(u?u.id:\"\");process.exit(0);}).catch(()=>{console.log(\"\");process.exit(0);});
"' 2>/dev/null | tr -d '\r\n')"
[[ -n "$ADMIN_ID" ]] || die "관리자 계정을 찾지 못했습니다 (DB 접속 실패일 수 있음)"

TOKEN="$(docker exec -e TU="$ADMIN_ID" "$WEB" sh -c 'cd /app/apps/web && node -e "
import(\"jose\").then(async ({SignJWT})=>{
  const t=await new SignJWT({userId:process.env.TU,role:\"ADMIN\",name:\"smoke\"})
    .setProtectedHeader({alg:\"HS256\"}).setExpirationTime(\"10m\")
    .sign(new TextEncoder().encode(process.env.JWT_SECRET));
  console.log(t);});
"' 2>/dev/null | tr -d '\r\n')"
[[ -n "$TOKEN" ]] || die "토큰 발급 실패 (JWT_SECRET 확인)"
CK="Cookie: token=$TOKEN"

check "관리자 인증(내 정보)" "200" "$(code_of -H "$CK" "$BASE/api/auth/me")"

# ── 3) 핵심 화면의 데이터 ────────────────────────────────────
# 화면은 클라이언트에서 그리므로 HTML 200 만으로는 부족하다. 화면이 부르는 API 를 직접 본다.
echo
echo "▸ 관리 기능"
for spec in \
  "직원 목록|/api/employees" \
  "지점 목록|/api/branches" \
  "관리자 대시보드|/api/admin/dashboard-stats" \
  "재직자 현황|/api/employees/stats/active?period=month" \
  "퇴직자 현황|/api/employees/stats/resigned?year=$(date +%Y)" \
  "출퇴근 기록|/api/attendance" \
  "오늘 출근자|/api/attendance/today-list" \
  "근무일정|/api/schedule?year=$(date +%Y)&month=$(date +%-m)" \
  "휴가 신청 목록|/api/leave" \
  "연차 잔여|/api/leave/balance" \
  "결재선 설정|/api/approval-line" \
  "전자계약|/api/contracts" \
  "계약 템플릿|/api/contract-templates" \
  "공휴일|/api/holidays?year=$(date +%Y)" \
  "개선 제안|/api/suggestions" \
  "메신저 채널|/api/work/channels" \
  "메신저 멤버|/api/work/members" \
  ; do
  NAME="${spec%%|*}"; PATH_="${spec#*|}"
  check "$NAME" "200" "$(code_of -H "$CK" "$BASE$PATH_")"
done

# ── 4) 페이지가 실제로 그려지는지 ────────────────────────────
echo
echo "▸ 페이지"
for spec in "로그인|/login" "대시보드|/dashboard" "직원 관리|/admin/employees" "휴가 관리|/admin/leave" "큐브티워크|/work"; do
  NAME="${spec%%|*}"; PATH_="${spec#*|}"
  check "$NAME" "200" "$(page_code_of -H "$CK" "$BASE$PATH_")"
done

# ── 5) 데이터가 실제로 담겨 오는지 ───────────────────────────
# 200 이어도 내용이 비어 있으면 화면은 빈 채로 뜬다. 형태를 확인한다.
echo
echo "▸ 응답 내용"
SHAPE="$(curl -s --max-time 20 -H "$CK" "$BASE/api/branches" 2>/dev/null | python3 -c '
import sys,json
try:
    d=json.load(sys.stdin); b=d.get("branches")
    print("ok" if isinstance(b,list) else "bad")
except Exception: print("bad")
' 2>/dev/null)"
check "지점 응답 형태" "ok" "$SHAPE"

STATS="$(curl -s --max-time 20 -H "$CK" "$BASE/api/admin/dashboard-stats" 2>/dev/null | python3 -c '
import sys,json
try:
    d=json.load(sys.stdin)
    print("ok" if isinstance(d.get("totalEmployees"),int) else "bad")
except Exception: print("bad")
' 2>/dev/null)"
check "대시보드 인원 숫자" "ok" "$STATS"

# ── 6) 스키마 정합성 ─────────────────────────────────────────
echo
echo "▸ 스키마"
DRIFT="$(docker exec -w /app/apps/web "$WEB" sh -c \
  'pnpm exec prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --script' \
  2>/dev/null | grep -c '^ALTER\|^DROP\|^CREATE')"
check "DB ↔ 스키마 차이" "0" "${DRIFT:-?}" "건"

# ── 7) 최근 오류 로그 ────────────────────────────────────────
echo
echo "▸ 최근 로그"
ERRS="$(docker logs --since 3m "$WEB" 2>&1 | grep -ciE '\berror\b|unhandled|ECONNREFUSED' || true)"
if [[ "${ERRS:-0}" -gt 0 ]]; then
  printf "  ! %-34s %s건 (참고 — 점검 자체로 생긴 401 도 잡힌다)\n" "오류 로그" "$ERRS"
  [[ $VERBOSE -eq 1 ]] && docker logs --since 3m "$WEB" 2>&1 | grep -iE '\berror\b|unhandled' | tail -5 | sed 's/^/      /'
else
  printf "  ✓ %-34s 없음\n" "오류 로그"
fi

# ── 결과 ─────────────────────────────────────────────────────
echo
echo "════════════════════════════════════════════════════════════"
if [[ $FAIL -eq 0 ]]; then
  echo "  통과 — $PASS 개 항목 전부 정상 ($LABEL)"
  echo "════════════════════════════════════════════════════════════"
  exit 0
else
  echo "  실패 $FAIL 개 / 통과 $PASS 개 ($LABEL)"
  echo "  실패 항목:$FAILED_LIST"
  echo "════════════════════════════════════════════════════════════"
  exit 1
fi
