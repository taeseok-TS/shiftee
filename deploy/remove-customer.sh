#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# 큐브티 — 고객사 인스턴스 제거
#
#   ./remove-customer.sh --code acme --yes
#   ./remove-customer.sh --code acme --yes --keep-data   # 컨테이너만 내리고 데이터는 남김
#
# 데이터(DB·업로드)를 지우는 작업이라 --yes 없이는 실행하지 않는다.
# 지우기 전에 마지막 백업을 뜨고, 그 파일은 남긴다.
# ─────────────────────────────────────────────────────────────
set -uo pipefail

BASE_DIR="${CUBETEE_BASE_DIR:-/opt/cubetee/customers}"
CADDY_DIR=/etc/caddy/customers
KEEP_ARCHIVE="${CUBETEE_ARCHIVE_DIR:-/root/backups/removed-customers}"

CODE=""; YES=0; KEEP_DATA=0; NO_BACKUP=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --code)      CODE="$2"; shift 2 ;;
    --yes)       YES=1; shift ;;
    --keep-data) KEEP_DATA=1; shift ;;
    --no-backup) NO_BACKUP=1; shift ;;
    -h|--help)   sed -n '2,12p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "알 수 없는 옵션: $1" >&2; exit 1 ;;
  esac
done

die()  { echo "✗ $*" >&2; exit 1; }
step() { echo; echo "▸ $*"; }
ok()   { echo "  ✓ $*"; }

[[ -n "$CODE" ]] || die "--code 필요"
DIR="$BASE_DIR/$CODE"
PROJECT="cubetee-$CODE"
[[ -d "$DIR" ]] || die "그런 고객사가 없습니다: $CODE"

if [[ $YES -ne 1 ]]; then
  if [[ $KEEP_DATA -eq 1 ]]; then
    echo "이 작업은 $CODE 의 컨테이너를 내립니다. (데이터는 유지)"
  else
    echo "이 작업은 $CODE 의 컨테이너와 데이터(DB·업로드)를 지웁니다. 되돌릴 수 없습니다."
  fi
  die "확인했다면 --yes 를 붙여 다시 실행할 것"
fi

# ── 1) 마지막 백업 ───────────────────────────────────────────
# 지우고 나서 "그거 좀 살려달라"는 요청은 반드시 온다. 미리 떠 둔다.
if [[ $NO_BACKUP -eq 0 && $KEEP_DATA -eq 0 ]]; then
  step "마지막 백업"
  if docker ps --format '{{.Names}}' | grep -qx "${PROJECT}-db-1"; then
    mkdir -p "$KEEP_ARCHIVE"
    PGUSER="$(grep -E '^POSTGRES_USER=' "$DIR/.env" 2>/dev/null | head -1 | cut -d= -f2-)"; PGUSER="${PGUSER:-postgres}"
    PGDB="$(grep -E '^POSTGRES_DB=' "$DIR/.env" 2>/dev/null | head -1 | cut -d= -f2-)"; PGDB="${PGDB:-cubetee}"
    FINAL="$KEEP_ARCHIVE/${CODE}-final-$(date +%Y%m%d-%H%M%S).sql.gz"
    if docker exec "${PROJECT}-db-1" pg_dump -U "$PGUSER" "$PGDB" | gzip > "$FINAL" && gunzip -t "$FINAL"; then
      ok "$FINAL ($(du -h "$FINAL" | cut -f1)) — 이 파일은 지우지 않는다"
    else
      rm -f "$FINAL"
      die "마지막 백업에 실패했다. 제거를 멈춘다(--no-backup 으로 강행 가능)"
    fi
  else
    echo "  db 컨테이너가 없다 — 백업 없이 진행"
  fi
fi

# ── 2) 도메인 연결 해제 ──────────────────────────────────────
# 컨테이너를 내리기 전에 뗀다. 안 그러면 잠깐 502 가 노출된다.
if [[ -f "$CADDY_DIR/${CODE}.caddy" ]]; then
  step "도메인 연결 해제"
  rm -f "$CADDY_DIR/${CODE}.caddy"
  if caddy validate --config /etc/caddy/Caddyfile >/dev/null 2>&1; then
    systemctl reload caddy && ok "caddy reload"
  else
    echo "  ⚠ caddy 설정 검증 실패 — 손으로 확인할 것"
  fi
fi

# ── 3) 컨테이너·볼륨 제거 ────────────────────────────────────
step "컨테이너 제거"
COMPOSE_FILE="$DIR/docker-compose.customer.yml"
DOWN_ARGS=(down)
[[ $KEEP_DATA -eq 0 ]] && DOWN_ARGS+=(-v)

if [[ -f "$COMPOSE_FILE" && -f "$DIR/.env" ]]; then
  (cd "$DIR" && docker compose -p "$PROJECT" -f "$COMPOSE_FILE" --env-file "$DIR/.env" "${DOWN_ARGS[@]}") >/dev/null 2>&1
fi

# compose 로 못 지운 것이 있으면 직접 지운다.
# (.env 가 없거나 깨져 있으면 compose 가 환경변수를 못 읽어 down 이 실패한다 — 실제로 겪었다)
LEFT="$(docker ps -aq --filter "name=${PROJECT}-" | wc -l)"
if [[ "$LEFT" -gt 0 ]]; then
  echo "  compose 로 남은 컨테이너 ${LEFT}개 — 직접 제거"
  docker rm -f $(docker ps -aq --filter "name=${PROJECT}-") >/dev/null 2>&1
fi
if [[ $KEEP_DATA -eq 0 ]]; then
  for v in $(docker volume ls -q --filter "name=${PROJECT}_"); do
    docker volume rm "$v" >/dev/null 2>&1
  done
fi
ok "컨테이너 $(docker ps -aq --filter "name=${PROJECT}-" | wc -l)개 / 볼륨 $(docker volume ls -q --filter "name=${PROJECT}_" | wc -l)개 남음"

# ── 4) 디렉터리 제거 ─────────────────────────────────────────
# 반드시 컨테이너가 다 내려간 뒤에 지운다. 먼저 지우면 .env 가 사라져
# compose 가 아무것도 못 하게 된다.
if [[ $KEEP_DATA -eq 1 ]]; then
  echo; echo "  --keep-data — 디렉터리와 볼륨을 남긴다: $DIR"
elif [[ "$(docker ps -aq --filter "name=${PROJECT}-" | wc -l)" -eq 0 ]]; then
  step "디렉터리 제거"
  rm -rf "$DIR"
  ok "$DIR 삭제"
else
  echo "  ⚠ 컨테이너가 남아 디렉터리는 보존한다 (손으로 확인할 것)"
fi

echo
echo "════════════════════════════════════════════════════════════"
echo "  제거 완료 — $CODE"
echo "════════════════════════════════════════════════════════════"
[[ -n "${FINAL:-}" ]] && echo "  마지막 백업  $FINAL"
echo
