#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# 큐브티 — 고객사 인스턴스 업데이트
#
#   # 한 곳에서 먼저 확인 (권장)
#   ./update-customers.sh --image cubetee:1.1.0 --only acme
#
#   # 문제 없으면 전체
#   ./update-customers.sh --image cubetee:1.1.0 --all
#
# 하는 일 (고객사마다): DB 백업 → 설정파일 갱신 → 이미지 태그 교체 →
#                       스키마 반영 → 컨테이너 교체 → 헬스체크 → 기능 점검
# 어느 단계든 실패하면 그 고객사는 이전 이미지로 되돌리고 전체를 중단한다.
# ─────────────────────────────────────────────────────────────
set -euo pipefail

BASE_DIR="${CUBETEE_BASE_DIR:-/opt/cubetee/customers}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

IMAGE=""; ONLY=""; ALL=0; DRY=0; SKIP_PUSH=0; NO_BACKUP=0; SKIP_SMOKE=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --image)     IMAGE="$2"; shift 2 ;;
    --only)      ONLY="$2";  shift 2 ;;
    --all)       ALL=1;      shift ;;
    --dry-run)   DRY=1;      shift ;;
    --skip-db-push) SKIP_PUSH=1; shift ;;
    --no-backup) NO_BACKUP=1; shift ;;
    --skip-smoke) SKIP_SMOKE=1; shift ;;
    -h|--help)
      sed -n '2,15p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) echo "알 수 없는 옵션: $1" >&2; exit 1 ;;
  esac
done

die()  { echo "✗ $*" >&2; exit 1; }
step() { echo; echo "▸ $*"; }
ok()   { echo "  ✓ $*"; }

[[ -n "$IMAGE" ]] || die "--image 필요 (예: --image cubetee:1.1.0)"
[[ -n "$ONLY" || $ALL -eq 1 ]] || die "--only <코드> 또는 --all 이 필요하다.
   처음에는 --only 로 한 곳만 돌려 확인할 것."

# ── 사전 점검 ────────────────────────────────────────────────
step "사전 점검"
docker image inspect "$IMAGE" >/dev/null 2>&1 \
  || die "이미지가 없습니다: $IMAGE   (먼저 빌드하거나 태그를 붙일 것)"
ok "이미지 $IMAGE"

[[ -d "$BASE_DIR" ]] || die "고객사 디렉터리가 없습니다: $BASE_DIR"

TARGETS=()
if [[ -n "$ONLY" ]]; then
  [[ -d "$BASE_DIR/$ONLY" ]] || die "그런 고객사가 없습니다: $ONLY"
  TARGETS=("$ONLY")
else
  for d in "$BASE_DIR"/*/; do
    [[ -d "$d" ]] || continue
    TARGETS+=("$(basename "$d")")
  done
fi
[[ ${#TARGETS[@]} -gt 0 ]] || die "업데이트할 고객사가 없습니다."
ok "대상 ${#TARGETS[@]}곳: ${TARGETS[*]}"

if [[ $DRY -eq 1 ]]; then
  echo; echo "  (--dry-run — 실제로 바꾸지 않는다)"
fi

STAMP="$(date +%Y%m%d-%H%M%S)"
DONE=(); FAILED=""

for CODE in "${TARGETS[@]}"; do
  DIR="$BASE_DIR/$CODE"
  PROJECT="cubetee-$CODE"
  echo; echo "════ $CODE ════"

  [[ -f "$DIR/.env" ]] || die "[$CODE] .env 가 없습니다 — 설치가 깨진 인스턴스다"

  # .env 에서 값 읽기 (파일을 source 하지 않는다 — 값에 특수문자가 있을 수 있음)
  PORT="$(grep -E '^WEB_PORT=' "$DIR/.env" | head -1 | cut -d= -f2-)"
  PREV_IMAGE="$(grep -E '^CUBETEE_IMAGE=' "$DIR/.env" | head -1 | cut -d= -f2-)"
  PGUSER="$(grep -E '^POSTGRES_USER=' "$DIR/.env" | head -1 | cut -d= -f2-)"; PGUSER="${PGUSER:-postgres}"
  PGDB="$(grep -E '^POSTGRES_DB=' "$DIR/.env" | head -1 | cut -d= -f2-)";     PGDB="${PGDB:-cubetee}"
  [[ -n "$PORT"       ]] || die "[$CODE] .env 에 WEB_PORT 가 없습니다"
  [[ -n "$PREV_IMAGE" ]] || die "[$CODE] .env 에 CUBETEE_IMAGE 가 없습니다"

  BK=""   # --no-backup 이면 비어 있다. 롤백 안내에서 참조하므로 미리 정의한다
  echo "  현재 $PREV_IMAGE → $IMAGE   (포트 $PORT)"
  if [[ "$PREV_IMAGE" == "$IMAGE" ]]; then
    ok "이미 같은 이미지 — 건너뛴다"
    DONE+=("$CODE(변경없음)")
    continue
  fi

  if [[ $DRY -eq 1 ]]; then
    ok "dry-run: 여기까지만"
    DONE+=("$CODE(dry)")
    continue
  fi

  COMPOSE=(docker compose -p "$PROJECT" -f "$DIR/docker-compose.customer.yml" --env-file "$DIR/.env")

  # ── 1) DB 백업 ─────────────────────────────────────────────
  if [[ $NO_BACKUP -eq 0 ]]; then
    step "[$CODE] DB 백업"
    mkdir -p "$DIR/backup"
    BK="$DIR/backup/pre-update-$STAMP.sql.gz"
    docker exec "${PROJECT}-db-1" pg_dump -U "$PGUSER" "$PGDB" | gzip > "$BK" \
      || die "[$CODE] 백업 실패 — 업데이트를 중단한다"
    gunzip -t "$BK" || die "[$CODE] 백업 파일이 깨졌다 — 업데이트를 중단한다"
    ok "$(basename "$BK") ($(du -h "$BK" | cut -f1))"
  else
    echo "  ⚠ --no-backup — 백업 없이 진행한다"
  fi

  # ── 2) 설정 파일 갱신 ──────────────────────────────────────
  # compose 파일은 설치 당시 복사본이라 오래됐을 수 있다. 새 환경변수가 추가된
  # 버전으로 배포하면서 이 파일을 안 바꾸면 그 값이 컨테이너에 주입되지 않는다.
  # .env 는 고객사별 비밀값이므로 절대 덮지 않는다.
  step "[$CODE] 설정 파일 갱신"
  cp "$HERE/docker-compose.customer.yml" "$DIR/docker-compose.customer.yml"
  cp "$HERE/init-tenant.js"              "$DIR/init-tenant.js"
  ok "compose · init-tenant 최신화 (.env 는 그대로)"

  # 프록시 설정도 갱신한다. new-customer.sh 의 템플릿만 고치면 **이미 설치된 고객사는
  # 영영 옛 설정**으로 남는다(2026-09-03 검증 지적). 무중단 재시도 설정이 대표적이다.
  # 도메인 줄은 건드리지 않고 reverse_proxy 블록만 갈아끼운다.
  CADDY_F="/etc/caddy/customers/${CODE}.caddy"
  if [[ -f "$CADDY_F" ]] && ! grep -q "lb_try_duration" "$CADDY_F"; then
    cp "$CADDY_F" "$CADDY_F.bak-$STAMP"
    # ⚠ sed 로 줄을 지워 다시 쌓는 방식은 **도메인 블록이 둘 이상이거나** reverse_proxy 가
    #   블록 형태({ header_up ... })면 파일을 망가뜨린다(2026-09-03 검증에서 실측).
    #   한 줄짜리 reverse_proxy 만, 그 줄 자리에서 그대로 바꾼다.
    if [[ $(grep -c "reverse_proxy" "$CADDY_F") -eq 1 ]] && grep -qE "^[[:space:]]*reverse_proxy[[:space:]]+[^{]*$" "$CADDY_F"; then
      awk -v port="$PORT" '
        /^[[:space:]]*reverse_proxy[[:space:]]+[^{]*$/ {
          print "    # 무중단 배포 - 컨테이너 교체 사이의 연결 거부 구간에서 502 를 내지 않고 기다렸다 붙는다."
          print "    # dial 실패는 메서드 불문, 그 밖의 전송 오류는 GET 만 재시도된다."
          print "    reverse_proxy localhost:" port " {"
          print "        lb_try_duration 20s"
          print "        lb_try_interval 250ms"
          print "    }"
          next
        }
        { print }
      ' "$CADDY_F.bak-$STAMP" > "$CADDY_F"
      if caddy validate --config /etc/caddy/Caddyfile >/dev/null 2>&1; then
        # reload 실패를 && 로 이으면 set -e 가 여기서 **조용히 스크립트를 끝낸다**. if 로 받는다.
        if systemctl reload caddy >/dev/null 2>&1; then
          ok "프록시 무중단 설정 반영"
        else
          echo "  ⚠ caddy reload 실패 — 설정은 바뀌었으나 적용되지 않았다. 수동 확인 필요."
        fi
      else
        mv "$CADDY_F.bak-$STAMP" "$CADDY_F"
        echo "  ⚠ 프록시 설정이 유효하지 않아 되돌렸다(다른 고객사 파일이 원인일 수도 있다): $CADDY_F"
      fi
    else
      echo "  ⚠ 프록시 설정이 예상과 달라 자동 변경하지 않았다 — 직접 확인할 것: $CADDY_F"
    fi
  fi

  # ── 3) 이미지 태그 교체 ────────────────────────────────────
  step "[$CODE] 이미지 태그 교체"
  cp "$DIR/.env" "$DIR/.env.bak-$STAMP"
  sed -i "s|^CUBETEE_IMAGE=.*|CUBETEE_IMAGE=$IMAGE|" "$DIR/.env"
  ok "CUBETEE_IMAGE=$IMAGE"

  # 실패 시 이전 상태로 되돌린다
  rollback() {
    echo "  ↩ 되돌리는 중..."
    cp "$DIR/.env.bak-$STAMP" "$DIR/.env"
    "${COMPOSE[@]}" up -d web >/dev/null 2>&1 || true
    if [[ -n "$BK" ]]; then
      echo "  ↩ $PREV_IMAGE 로 복구했다. DB 는 $BK 로 되돌릴 수 있다(자동 복구는 하지 않는다)."
    else
      echo "  ↩ $PREV_IMAGE 로 복구했다. (--no-backup 이라 DB 백업은 없다)"
    fi
  }

  # ── 4) 스키마 반영 ─────────────────────────────────────────
  if [[ $SKIP_PUSH -eq 0 ]]; then
    step "[$CODE] 스키마 반영"
    # 새 이미지로 일회성 컨테이너를 띄워 db push. 데이터가 지워질 변경이면
    # prisma 가 스스로 멈추므로(--accept-data-loss 를 주지 않는다) 안전하다.
    if ! "${COMPOSE[@]}" run --rm --no-deps -T web \
         sh -c 'cd /app/apps/web && pnpm exec prisma db push --skip-generate' 2>&1 | tail -5; then
      rollback
      die "[$CODE] 스키마 반영 실패 — 데이터가 지워지는 변경이면 손으로 확인할 것"
    fi
    ok "완료"
  else
    echo "  --skip-db-push — 스키마는 건드리지 않는다"
  fi

  # ── 5) 컨테이너 교체 ───────────────────────────────────────
  step "[$CODE] 웹 교체"
  "${COMPOSE[@]}" up -d --force-recreate web >/dev/null 2>&1 || { rollback; die "[$CODE] 기동 실패"; }
  ok "기동"

  # ── 6) 헬스체크 ────────────────────────────────────────────
  step "[$CODE] 헬스체크"
  HEALTHY=0
  for _ in $(seq 1 30); do
    CODE_HTTP="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/login" || true)"
    if [[ "$CODE_HTTP" == "200" ]]; then HEALTHY=1; break; fi
    sleep 2
  done
  if [[ $HEALTHY -ne 1 ]]; then
    echo "  ✗ 60초 안에 200 이 오지 않았다 (마지막 응답: ${CODE_HTTP:-없음})"
    "${COMPOSE[@]}" logs --tail 20 web 2>&1 | sed 's/^/    /'
    rollback
    die "[$CODE] 헬스체크 실패"
  fi
  ok "HTTP 200"

  # ── 7) 기능 점검 ───────────────────────────────────────────
  # 헬스체크는 "서버가 살아있다"까지만 본다. 그 뒤 화면들이 500 을 내도 통과한다.
  if [[ $SKIP_SMOKE -eq 0 && -x "$HERE/smoke-test.sh" ]]; then
    step "[$CODE] 기능 점검"
    if "$HERE/smoke-test.sh" --code "$CODE" > /tmp/smoke-$CODE.log 2>&1; then
      ok "$(grep -oE '통과 — [0-9]+ 개' /tmp/smoke-$CODE.log | head -1)"
    else
      grep -E '✗|실패 항목' /tmp/smoke-$CODE.log | sed 's/^/    /'
      rollback
      die "[$CODE] 기능 점검 실패 — 전체 결과: /tmp/smoke-$CODE.log"
    fi
  fi

  rm -f "$DIR/.env.bak-$STAMP"
  DONE+=("$CODE")
done

# ── 요약 ─────────────────────────────────────────────────────
echo
echo "════════════════════════════════════════════════════════════"
echo "  업데이트 완료 — ${#DONE[@]}곳"
echo "════════════════════════════════════════════════════════════"
for c in "${DONE[@]}"; do echo "  · $c"; done
[[ -n "$FAILED" ]] && echo "  실패: $FAILED"
echo
echo "  이미지 $IMAGE"
[[ $NO_BACKUP -eq 0 && $DRY -eq 0 ]] && \
  echo "  업데이트 직전 백업: 각 고객사 backup/pre-update-$STAMP.sql.gz"
echo
