#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# 배포 전 정합 점검 — 운영 서버 파일이 git HEAD 와 일치하는지 확인한다.
#
#   bash deploy/preflight.sh            # 점검만
#   bash deploy/preflight.sh --strict   # 불일치가 있으면 종료코드 1 (배포 중단용)
#
# 왜 필요한가:
#   여러 세션이 같은 프로젝트를 건드리는 구조라, 커밋되지 않은 변경이 운영에만
#   남아 있는 일이 실제로 있었다(원장 겸직·연차 전환·봇 DM). 그 상태에서 재빌드하면
#   ① 남의 미완성 작업이 딸려 나가거나 ② 운영에 있던 수정이 조용히 사라진다.
# ─────────────────────────────────────────────────────────────
set -uo pipefail

SSH="ssh -i ${DEPLOY_KEY:-$HOME/.ssh/qubetee_deploy} root@${DEPLOY_HOST:-64.176.228.203}"
REMOTE_DIR="${REMOTE_DIR:-/opt/qubetee}"
STRICT=0
[[ "${1:-}" == "--strict" ]] && STRICT=1

cd "$(dirname "${BASH_SOURCE[0]}")/.."

echo "▸ 로컬 상태"
BRANCH=$(git branch --show-current)
echo "  브랜치 $BRANCH / HEAD $(git rev-parse --short HEAD)"

# 배포로 덮이는 것 전부를 본다. 종전에는 apps/web/src 만 봐서, 저장소 compose 가 운영보다
# 낡아 있는 것을 못 잡았다 — 그대로 배포했으면 gotenberg 한글 폰트 마운트가 조용히 사라졌다
# (2026-09-02). schema.prisma 는 운영 DB 와의 드리프트가 반복해서 사고를 냈던 파일이다.
# Dockerfile 이 `COPY . .` 로 저장소 전체를 이미지에 넣으므로 빌드에 들어가는 것은 전부 본다.
# 2026-09-02 검증에서 packages/api, pnpm-workspace.yaml 등 9개가 운영과 어긋난 상태인데도
# "일치, 배포해도 된다"가 나왔다.
WATCH="apps/web/src apps/web/prisma apps/web/next.config.ts apps/web/package.json packages Dockerfile docker-compose.yml pnpm-workspace.yaml pnpm-lock.yaml package.json deploy"

DIRTY=$(git status --porcelain -- $WATCH | wc -l)
[[ $DIRTY -gt 0 ]] && echo "  ⚠ 커밋되지 않은 변경 ${DIRTY}건 (아래 대조에서 운영과 어긋나면 원인일 수 있음)"

# 급여 필드가 스테이지에 섞였는지 (weekend-pay 세션과의 사고 방지)
PAY=$(git diff --cached -- apps/web/src | grep -cE "canViewPayroll|monthlySalary" || true)
[[ $PAY -gt 0 ]] && echo "  ✗ 스테이지에 급여 필드 ${PAY}건 — 커밋 전 확인 필요"

echo
echo "▸ 운영 파일 ↔ 로컬 대조 ($WATCH)"
# 추적 파일 + 신규(untracked) 파일. 원격 해시는 한 번의 ssh 로 모아 온다(파일마다 접속하면 느리다).
# 줄바꿈(CRLF/LF)은 제거하고 비교한다 — 윈도우 체크아웃과 서버 파일이 줄바꿈만 달라도 전부 다르게 잡힌다.
# core.quotepath=false: 한글 파일명을 ì... 로 이스케이프하지 않게 한다
# (이스케이프되면 이름이 안 맞아 "로컬에만 있음"으로 잘못 잡히고 cat 도 실패한다)
# ⚠ 배포(rsync)로 /opt/qubetee 에 가지 **않는** 것은 대조에서 뺀다. 호스트에 직접 설치되는
#   자산(워치독.방화벽 유닛)까지 비교하면 매번 "로컬에만 있음"이 떠서, --strict 면 배포가
#   영구히 막히고 안 쓰면 사람이 "원래 뜨는 것"으로 학습해 진짜 불일치를 놓친다
#   (2026-09-04 검증관 C C-2 — 게이트 무력화). 대신 아래에서 설치 위치로 직접 대조한다.
HOST_ONLY='^deploy/(watchdog|firewall)/'
git -c core.quotepath=false ls-files --cached --others --exclude-standard $WATCH   | grep -Ev "$HOST_ONLY" > /tmp/pf-files.txt
REMOTE_MD5S=$($SSH "cd '$REMOTE_DIR' && while IFS= read -r p; do [ -f \"\$p\" ] && printf '%s	%s\n' \"\$(tr -d '\r' < \"\$p\" | md5sum | cut -d' ' -f1)\" \"\$p\"; done" < /tmp/pf-files.txt)

HOST_PAIRS="deploy/watchdog/qubetee-watchdog.py:/usr/local/sbin/qubetee-watchdog.py
deploy/watchdog/qubetee-watchdog.service:/etc/systemd/system/qubetee-watchdog.service
deploy/watchdog/qubetee-watchdog.timer:/etc/systemd/system/qubetee-watchdog.timer
deploy/firewall/qubetee-firewall.sh:/usr/local/sbin/qubetee-firewall.sh
deploy/firewall/after.init:/etc/ufw/after.init
deploy/firewall/qubetee-firewall.service:/etc/systemd/system/qubetee-firewall.service
deploy/firewall/qubetee-firewall.timer:/etc/systemd/system/qubetee-firewall.timer
deploy/firewall/qubetee-firewall-alert.service:/etc/systemd/system/qubetee-firewall-alert.service"

DIFF_COUNT=0
while IFS= read -r f; do
  LOCAL_MD5=$(tr -d '\r' < "$f" | md5sum | cut -d' ' -f1)
  # 탭 구분 + ENVIRON - 파일명에 공백이 있으면 경로가 잘려 "로컬에만 있음" 오탐이 나고,
  # awk -v 는 값 안의 역슬래시를 이스케이프로 해석한다
  REMOTE_MD5=$(printf '%s
' "$REMOTE_MD5S" | P="$f" awk -F'	' 'ENVIRON["P"]==$2 {print $1}')
  if [[ -z "$REMOTE_MD5" ]]; then
    echo "  + 로컬에만 있음(운영 미반영): $f"; DIFF_COUNT=$((DIFF_COUNT+1))
  elif [[ "$REMOTE_MD5" != "$LOCAL_MD5" ]]; then
    echo "  ≠ 다름: $f"; DIFF_COUNT=$((DIFF_COUNT+1))
  fi
done < /tmp/pf-files.txt

# 호스트에 직접 설치되는 자산은 설치 위치로 대조한다. 이게 없으면 서버에만 있고 저장소에는
# 없는 스크립트가 생기고(9/4 방화벽 6종이 그랬다), 서버를 재설치하면 통째로 소실된다.
echo
echo "▸ 호스트 설치 자산 대조 (도커 밖 — 워치독.방화벽)"
while IFS=: read -r LOCAL REMOTE; do
  [[ -z "$LOCAL" ]] && continue
  if [[ ! -f "$LOCAL" ]]; then
    echo "  ? 저장소에 없음: $LOCAL"; DIFF_COUNT=$((DIFF_COUNT+1)); continue
  fi
  LM=$(tr -d '' < "$LOCAL" | md5sum | cut -d' ' -f1)
  RM=$($SSH "[ -f '$REMOTE' ] && tr -d '' < '$REMOTE' | md5sum | cut -d' ' -f1" 2>/dev/null)
  if [[ -z "$RM" ]]; then
    echo "  + 서버에 설치 안 됨: $REMOTE"; DIFF_COUNT=$((DIFF_COUNT+1))
  elif [[ "$RM" != "$LM" ]]; then
    echo "  ≠ 다름: $LOCAL ↔ $REMOTE"; DIFF_COUNT=$((DIFF_COUNT+1))
  fi
done <<< "$HOST_PAIRS"
rm -f /tmp/pf-files.txt

# 프록시 설정 대조 — /etc/caddy/Caddyfile 은 /opt/qubetee 밖이라 위 루프가 못 본다.
# 운영에만 있고 저장소에 없는 설정은 아무에게도 안 보인다(2026-09-02 compose 사고).
if [[ -f deploy/Caddyfile ]]; then
  # 저장소 사본은 맨 위에 설명 주석이 붙어 있으므로, 그 부분을 뺀 실제 설정만 비교한다
  LOCAL_CADDY=$(sed '/^#/d;/^$/d' deploy/Caddyfile | tr -d '' | md5sum | cut -d' ' -f1)
  REMOTE_CADDY=$($SSH "sed '/^#/d;/^\$/d' /etc/caddy/Caddyfile 2>/dev/null | tr -d '' | md5sum | cut -d' ' -f1")
  if [[ "$LOCAL_CADDY" != "$REMOTE_CADDY" ]]; then
    echo "  ≠ 다름: /etc/caddy/Caddyfile (저장소 사본 deploy/Caddyfile 과 어긋남)"
    DIFF_COUNT=$((DIFF_COUNT+1))
  fi
fi


echo
if [[ $DIFF_COUNT -eq 0 ]]; then
  echo "✓ 운영과 로컬이 일치한다. 배포해도 된다."
  exit 0
fi

echo "✗ 불일치 ${DIFF_COUNT}건."
echo "  운영에만 있는 변경이라면 커밋해서 HEAD 를 맞추고,"
echo "  로컬에만 있는 변경이라면 의도한 배포분인지 확인한 뒤 진행할 것."
echo "  파일별 실제 차이:  ssh ... \"cat $REMOTE_DIR/<경로>\" | diff - <경로>"
[[ $STRICT -eq 1 ]] && exit 1
exit 0
