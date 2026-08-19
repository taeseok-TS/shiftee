#!/bin/bash
# 큐브티 고객사 일일 백업 — 인스턴스마다 DB 덤프(14일 보관) + 업로드 파일 미러
# cron: /etc/cron.d/cubetee-backup (매일 19:45 UTC = KST 04:45), 로그: /var/log/cubetee-backup.log
#
# 직영(/opt/backup-daily.sh)과 다른 점:
#   · 고객사 수가 0~N 이라 순회한다. 한 곳이 실패해도 나머지는 계속 돈다(set -e 안 씀)
#   · 백업 위치는 각 고객사 디렉터리 안(backup/) — 인스턴스 통째로 옮길 때 같이 간다
BASE=/opt/cubetee/customers
TS=$(date +%Y%m%d)
STAMP=$(date -u +%F\ %T)

[ -d "$BASE" ] || { echo "$STAMP customers dir 없음 — 건너뜀"; exit 0; }

FOUND=0; OK=0; FAIL=0
for d in "$BASE"/*/; do
  [ -d "$d" ] || continue
  CODE=$(basename "$d")
  FOUND=$((FOUND+1))

  # .env 에서 DB 접속 정보 (없으면 기본값)
  PGUSER=$(grep -E '^POSTGRES_USER=' "$d/.env" 2>/dev/null | head -1 | cut -d= -f2-); PGUSER=${PGUSER:-postgres}
  PGDB=$(grep -E '^POSTGRES_DB=' "$d/.env" 2>/dev/null | head -1 | cut -d= -f2-);     PGDB=${PGDB:-cubetee}
  DBC="cubetee-${CODE}-db-1"

  if ! docker ps --format '{{.Names}}' | grep -qx "$DBC"; then
    echo "$STAMP [$CODE] db 컨테이너 없음($DBC) — 건너뜀"; FAIL=$((FAIL+1)); continue
  fi

  mkdir -p "$d/backup"

  # 1) DB 덤프 — .tmp 로 받고 무결성 검증 후 바꿔치기(중간에 죽어도 깨진 파일이 남지 않게)
  if docker exec "$DBC" pg_dump -U "$PGUSER" "$PGDB" | gzip > "$d/backup/$TS.sql.gz.tmp" \
     && gunzip -t "$d/backup/$TS.sql.gz.tmp" 2>/dev/null; then
    mv "$d/backup/$TS.sql.gz.tmp" "$d/backup/$TS.sql.gz"
    SIZE=$(stat -c %s "$d/backup/$TS.sql.gz")
  else
    rm -f "$d/backup/$TS.sql.gz.tmp"
    echo "$STAMP [$CODE] DB 덤프 실패"; FAIL=$((FAIL+1)); continue
  fi

  # 2) 업로드 볼륨 미러 (계약서 서명본·채팅 파일)
  VOL=/var/lib/docker/volumes/cubetee-${CODE}_uploads/_data
  if [ -d "$VOL" ]; then
    rsync -a --delete "$VOL/" "$d/backup/uploads-mirror/" 2>/dev/null
    UP=$(du -sh "$d/backup/uploads-mirror" 2>/dev/null | cut -f1)
  else
    UP="-"
  fi

  # 3) 덤프 14일 보관 (미러는 항상 최신 1벌)
  find "$d/backup" -maxdepth 1 -name '*.sql.gz' -mtime +14 -delete

  echo "$STAMP [$CODE] backup ok: $SIZE bytes, uploads $UP"
  OK=$((OK+1))
done

if [ "$FOUND" -eq 0 ]; then
  echo "$STAMP 고객사 없음 — 할 일 없음"
else
  echo "$STAMP 고객사 백업 요약: 성공 $OK / 실패 $FAIL (총 $FOUND)"
fi

# 실패가 있으면 종료코드로 알린다(cron 메일·모니터링에서 잡을 수 있게)
[ "$FAIL" -eq 0 ]
