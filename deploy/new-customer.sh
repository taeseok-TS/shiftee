#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# 큐브티 — 신규 고객사 인스턴스 생성 (원커맨드)
#
#   ./new-customer.sh --code acme --domain hr.acme.co.kr --port 3101 \
#                     --email admin@acme.co.kr --name "홍길동" --branch "본점"
#
# 하는 일: 디렉터리 생성 → 비밀값 생성 → DB 기동 → 스키마 생성 →
#          웹 기동 → 관리자 계정 생성 → 접속정보 파일로 저장
# ─────────────────────────────────────────────────────────────
set -euo pipefail

BASE_DIR="${CUBETEE_BASE_DIR:-/opt/cubetee/customers}"
IMAGE="${CUBETEE_IMAGE:-cubetee:latest}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

BASE_DOMAIN="${CUBETEE_BASE_DOMAIN:-cubetee.co.kr}"
CODE=""; DOMAIN=""; PORT=""; EMAIL=""; NAME="관리자"; BRANCH=""; NO_PROXY=0; CONFIG=""; COMPANY=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --code)   CODE="$2";   shift 2 ;;
    --domain) DOMAIN="$2"; shift 2 ;;
    --port)   PORT="$2";   shift 2 ;;
    --email)  EMAIL="$2";  shift 2 ;;
    --name)   NAME="$2";   shift 2 ;;
    --branch) BRANCH="$2"; shift 2 ;;
    --image)  IMAGE="$2";  shift 2 ;;
    --no-proxy) NO_PROXY=1; shift ;;
    --config) CONFIG="$2"; shift 2 ;;
    *) echo "알 수 없는 옵션: $1" >&2; exit 1 ;;
  esac
done

die() { echo "✗ $*" >&2; exit 1; }
step() { echo; echo "▸ $*"; }


# ── 설정 파일(--config) ──────────────────────────────────────
# 고객사에게 받은 온보딩 양식을 그대로 쓴다. 명령행 인자가 우선한다.
# source 하지 않고 한 줄씩 읽는다 — 값에 무엇이 들어올지 모른다.
if [[ -n "$CONFIG" ]]; then
  [[ -f "$CONFIG" ]] || die "설정 파일이 없습니다: $CONFIG"
  cfg() { grep -E "^[[:space:]]*$1[[:space:]]*=" "$CONFIG" | head -1 | cut -d= -f2- | sed 's/[[:space:]]*#.*$//' | xargs; }
  [[ -n "$CODE"   ]] || CODE="$(cfg code)"
  [[ -n "$EMAIL"  ]] || EMAIL="$(cfg admin_email)"
  [[ -n "$BRANCH" ]] || BRANCH="$(cfg branches)"
  [[ -n "$DOMAIN" ]] || DOMAIN="$(cfg domain)"
  [[ -n "$PORT"   ]] || PORT="$(cfg port)"
  COMPANY="$(cfg company)"
  N="$(cfg admin_name)"; [[ -n "$N" && "$NAME" == "관리자" ]] && NAME="$N"
  echo "  설정 파일 $CONFIG ${COMPANY:+— $COMPANY}"
fi

# ── 포트 자동 할당 ───────────────────────────────────────────
# 포트는 우리 내부 사정이라 고객사에게 물을 값이 아니다. 비어 있는 것을 찾아 쓴다.
if [[ -z "$PORT" ]]; then
  for try in $(seq 3101 3199); do
    if ! ss -ltn 2>/dev/null | grep -q ":${try}"        && ! grep -rqs "^WEB_PORT=${try}$" "$BASE_DIR"/*/.env 2>/dev/null; then
      PORT="$try"; break
    fi
  done
  [[ -n "$PORT" ]] || die "3101~3199 에 빈 포트가 없습니다"
  echo "  포트 미지정 → $PORT 사용"
fi

# --domain 을 안 주면 큐브티 하위 도메인을 쓴다(고객사가 도메인이 없어도 당일 오픈).
# 와일드카드 A 레코드(*.cubetee.co.kr)가 걸려 있어야 인증서가 발급된다.
if [[ -z "$DOMAIN" ]]; then
  DOMAIN="${CODE}.${BASE_DOMAIN}"
  echo "  도메인 미지정 → $DOMAIN 사용"
fi

[[ -n "$CODE"   ]] || die "--code 필요 (영문 소문자·숫자·하이픈). --config 파일에 code= 로 넣어도 된다"
[[ -n "$EMAIL"  ]] || die "--email 필요 (관리자 계정)"
[[ "$CODE" =~ ^[a-z0-9-]+$ ]] || die "--code 는 영문 소문자·숫자·하이픈만 가능"

PROJECT="cubetee-${CODE}"
DIR="${BASE_DIR}/${CODE}"

# ── 사전 점검 ────────────────────────────────────────────────
step "사전 점검"
command -v docker >/dev/null || die "docker 가 없습니다"
docker compose version >/dev/null 2>&1 || die "docker compose(v2) 가 없습니다"
[[ -d "$DIR" ]] && die "이미 존재합니다: $DIR  (덮어쓰지 않습니다)"
docker image inspect "$IMAGE" >/dev/null 2>&1 || die "이미지가 없습니다: $IMAGE  (먼저 빌드하세요)"

if ss -ltn 2>/dev/null | grep -q ":${PORT}\b"; then
  die "포트 ${PORT} 가 이미 사용 중입니다"
fi
echo "  이미지 $IMAGE · 포트 $PORT · 프로젝트 $PROJECT"

# ── 디렉터리와 설정 ──────────────────────────────────────────
step "설정 파일 생성"
mkdir -p "$DIR/backup"
cp "$HERE/docker-compose.customer.yml" "$DIR/"
cp "$HERE/init-tenant.js" "$DIR/"

POSTGRES_PASSWORD="$(openssl rand -base64 24 | tr -d '/+=' | head -c 28)"
JWT_SECRET="$(openssl rand -base64 48 | tr -d '/+=' | head -c 56)"

cat > "$DIR/.env" <<EOF
# 큐브티 고객사 인스턴스 — $CODE
# 생성일 $(date '+%Y-%m-%d %H:%M:%S')
CUBETEE_IMAGE=$IMAGE
COMPOSE_PROJECT_NAME=$PROJECT

POSTGRES_USER=postgres
POSTGRES_DB=cubetee
POSTGRES_PASSWORD=$POSTGRES_PASSWORD
JWT_SECRET=$JWT_SECRET

WEB_PORT=$PORT
APP_URL=https://$DOMAIN
COOKIE_SECURE=true

# 메일 발송이 필요하면 채우세요 (전자계약 서명 요청은 메일로 나갑니다)
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
# 수신자에게 보이는 발신자. 비우면 SMTP_USER 주소로 나갑니다.
SMTP_FROM_NAME=큐브티
SMTP_FROM_EMAIL=
EOF
chmod 600 "$DIR/.env"
echo "  $DIR/.env (600)"

cd "$DIR"
COMPOSE=(docker compose -p "$PROJECT" -f docker-compose.customer.yml)

# 실패하면 만들다 만 것을 치운다
cleanup_on_fail() {
  echo; echo "✗ 실패 — 정리합니다"
  "${COMPOSE[@]}" down -v >/dev/null 2>&1 || true
  echo "  컨테이너·볼륨 삭제됨. 디렉터리는 남겨둡니다(로그·설정 확인용): $DIR"
  echo "  같은 코드로 다시 설치하려면 먼저 지우세요:  rm -rf $DIR"
}
trap cleanup_on_fail ERR

# ── DB 기동 ──────────────────────────────────────────────────
step "데이터베이스 기동"
"${COMPOSE[@]}" up -d db
for i in $(seq 1 40); do
  if "${COMPOSE[@]}" exec -T db pg_isready -U postgres -d cubetee >/dev/null 2>&1; then
    echo "  준비 완료 (${i}회 확인)"; break
  fi
  [[ $i -eq 40 ]] && die "DB가 준비되지 않습니다"
  sleep 2
done

# ── 스키마 생성 ──────────────────────────────────────────────
# migrations 이력이 없는 프로젝트이므로 schema.prisma 기준으로 직접 만든다.
# 빈 DB에서는 db push 가 안전하다(기존 데이터가 없으므로 손실 위험 없음).
step "스키마 생성 (prisma db push)"
"${COMPOSE[@]}" run --rm --no-deps -T web pnpm exec prisma db push --skip-generate
echo "  완료"

# ── 웹 기동 ──────────────────────────────────────────────────
step "웹 서버 기동"
"${COMPOSE[@]}" up -d web
for i in $(seq 1 40); do
  if curl -fsS -o /dev/null "http://127.0.0.1:${PORT}/" 2>/dev/null; then
    echo "  응답 확인 (${i}회 확인)"; break
  fi
  [[ $i -eq 40 ]] && die "웹이 응답하지 않습니다 — 로그: ${COMPOSE[*]} logs web"
  sleep 3
done

# ── 관리자 계정 ──────────────────────────────────────────────
step "관리자 계정 생성"
INIT_ARGS=(--email "$EMAIL" --name "$NAME")
[[ -n "$BRANCH" ]] && INIT_ARGS+=(--branch "$BRANCH")
INIT_OUT="$("${COMPOSE[@]}" exec -T web node init-tenant.js "${INIT_ARGS[@]}")"
echo "$INIT_OUT"

trap - ERR

# ── 도메인 연결 (Caddy) ──────────────────────────────────────
# Caddy 가 도메인별로 인증서를 자동 발급·갱신한다. 와일드카드 인증서(DNS-01)를
# 쓰지 않으므로 별도 DNS API 토큰이 필요 없다. 대신 그 도메인의 A 레코드가
# 이 서버를 가리켜야 발급된다(*.cubetee.co.kr 와일드카드 한 줄이면 전부 해결).
CADDY_DIR=/etc/caddy/customers
PROXY_NOTE=""
if [[ $NO_PROXY -eq 1 ]]; then
  PROXY_NOTE="  프록시 등록  건너뜀(--no-proxy) — 직접 연결할 것"
elif [[ ! -d "$CADDY_DIR" ]]; then
  PROXY_NOTE="  프록시 등록  건너뜀($CADDY_DIR 없음) — Caddy 설정을 확인할 것"
else
  step "도메인 연결"
  cat > "$CADDY_DIR/${CODE}.caddy" <<CADDYEOF
# $CODE — new-customer.sh 가 생성 ($(date '+%Y-%m-%d %H:%M'))
$DOMAIN {
    reverse_proxy localhost:$PORT
}
CADDYEOF
  if ! caddy validate --config /etc/caddy/Caddyfile >/dev/null 2>&1; then
    rm -f "$CADDY_DIR/${CODE}.caddy"
    die "Caddy 설정이 유효하지 않아 되돌렸습니다 — 도메인($DOMAIN)을 확인하세요"
  fi
  systemctl reload caddy || die "caddy reload 실패"
  echo "  $DOMAIN → 127.0.0.1:$PORT"

  # 인증서 발급까지 기다린다(보통 수 초). 실패해도 설치는 성공으로 둔다 —
  # DNS 전파처럼 우리 손 밖의 이유일 수 있고, 나중에 저절로 발급된다.
  HTTPS_OK=0
  for _ in $(seq 1 15); do
    if [[ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "https://$DOMAIN/login" 2>/dev/null)" == "200" ]]; then
      HTTPS_OK=1; break
    fi
    sleep 2
  done
  if [[ $HTTPS_OK -eq 1 ]]; then
    echo "  ✓ https://$DOMAIN 접속 확인 (인증서 발급 완료)"
    PROXY_NOTE="  접속 주소    https://$DOMAIN   ← 바로 쓸 수 있다"
  else
    DNSIP="$(dig +short A "$DOMAIN" 2>/dev/null | tail -1)"
    MYIP="$(curl -s -4 --max-time 5 ifconfig.me 2>/dev/null)"
    echo "  ⚠ 아직 https 응답이 없다 (인증서 발급 대기)"
    PROXY_NOTE="  접속 주소    https://$DOMAIN  ← 아직 응답 없음
    DNS 확인   $DOMAIN → ${DNSIP:-(레코드 없음)} / 이 서버 ${MYIP:-?}
    두 값이 다르면 DNS 문제다. 가비아에 와일드카드 A 레코드(*)가 있는지 확인할 것.
    DNS 가 맞으면 1~2분 뒤 저절로 발급된다."
  fi
fi

# ── 결과 저장 ────────────────────────────────────────────────
COMPOSE_HINT="docker compose -p $PROJECT -f docker-compose.customer.yml"
INFO="$DIR/접속정보.txt"
{
  echo "큐브티 고객사 인스턴스 — $CODE"
  echo "생성일 $(date '+%Y-%m-%d %H:%M:%S')"
  echo
  echo "접속 주소   https://$DOMAIN   (내부 http://127.0.0.1:$PORT)"
  echo "compose     docker compose -p $PROJECT -f docker-compose.customer.yml"
  echo "디렉터리    $DIR"
  echo
  echo "$INIT_OUT"
} > "$INFO"
chmod 600 "$INFO"

cat <<EOF

════════════════════════════════════════════════════════════
  설치 완료 — $CODE
════════════════════════════════════════════════════════════
  접속정보  $INFO   (초기 비밀번호 포함, 권한 600)
  내부주소  http://127.0.0.1:$PORT

$PROXY_NOTE
  오픈 후 함께 정할 것
    · 지점 좌표·반경 — 출퇴근 판정에 쓰인다. 주소만으로는 부정확하니 실제 값으로 고칠 것
    · 근무·휴가 정책 (결재선, 연차 기준, 주말 근무 승인)
    · 발신 메일(SMTP) — 고객사 도메인 인증이 필요하다
  (백업은 자동이다 — 매일 KST 04:45, backup/ 에 14일 보관)
════════════════════════════════════════════════════════════
EOF
