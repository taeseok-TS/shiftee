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

CODE=""; DOMAIN=""; PORT=""; EMAIL=""; NAME="관리자"; BRANCH=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --code)   CODE="$2";   shift 2 ;;
    --domain) DOMAIN="$2"; shift 2 ;;
    --port)   PORT="$2";   shift 2 ;;
    --email)  EMAIL="$2";  shift 2 ;;
    --name)   NAME="$2";   shift 2 ;;
    --branch) BRANCH="$2"; shift 2 ;;
    --image)  IMAGE="$2";  shift 2 ;;
    *) echo "알 수 없는 옵션: $1" >&2; exit 1 ;;
  esac
done

die() { echo "✗ $*" >&2; exit 1; }
step() { echo; echo "▸ $*"; }

[[ -n "$CODE"   ]] || die "--code 필요 (영문 소문자·숫자·하이픈)"
[[ -n "$DOMAIN" ]] || die "--domain 필요 (예: hr.acme.co.kr)"
[[ -n "$PORT"   ]] || die "--port 필요 (예: 3101)"
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

# 메일 발송이 필요하면 채우세요
SMTP_HOST=
SMTP_PORT=
SMTP_USER=
SMTP_PASS=
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

  남은 일 (수동)
    1) 리버스 프록시에 $DOMAIN → 127.0.0.1:$PORT 연결 + TLS 발급
       ※ TLS 를 붙이기 전에는 브라우저 로그인이 되지 않는다. 세션 쿠키가 Secure 라
         http 접속에서는 브라우저가 저장하지 않기 때문(API 는 200 이 와도 화면은 로그인 상태가 안 됨).
         TLS 없이 먼저 확인하려면: COOKIE_SECURE=false $COMPOSE_HINT up -d web
    2) 지점 좌표·반경을 실제 값으로 수정 (출퇴근 판정에 사용됨)
    3) 이 인스턴스를 백업 대상에 추가 (deploy/README.md 참고)
════════════════════════════════════════════════════════════
EOF
