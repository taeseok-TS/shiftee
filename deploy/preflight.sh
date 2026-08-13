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

DIRTY=$(git status --porcelain -- apps/web/src | wc -l)
[[ $DIRTY -gt 0 ]] && echo "  ⚠ 커밋되지 않은 변경 ${DIRTY}건 (아래 대조에서 운영과 어긋나면 원인일 수 있음)"

# 급여 필드가 스테이지에 섞였는지 (weekend-pay 세션과의 사고 방지)
PAY=$(git diff --cached -- apps/web/src | grep -cE "canViewPayroll|monthlySalary" || true)
[[ $PAY -gt 0 ]] && echo "  ✗ 스테이지에 급여 필드 ${PAY}건 — 커밋 전 확인 필요"

echo
echo "▸ 운영 파일 ↔ 로컬 대조 (apps/web/src)"
# 추적 파일 + 신규(untracked) 파일. 원격 해시는 한 번의 ssh 로 모아 온다(파일마다 접속하면 느리다).
# 줄바꿈(CRLF/LF)은 제거하고 비교한다 — 윈도우 체크아웃과 서버 파일이 줄바꿈만 달라도 전부 다르게 잡힌다.
git ls-files --cached --others --exclude-standard apps/web/src > /tmp/pf-files.txt
REMOTE_MD5S=$($SSH "cd '$REMOTE_DIR' && while IFS= read -r p; do [ -f \"\$p\" ] && printf '%s %s\n' \"\$(tr -d '\r' < \"\$p\" | md5sum | cut -d' ' -f1)\" \"\$p\"; done" < /tmp/pf-files.txt)

DIFF_COUNT=0
while IFS= read -r f; do
  LOCAL_MD5=$(tr -d '\r' < "$f" | md5sum | cut -d' ' -f1)
  REMOTE_MD5=$(printf '%s\n' "$REMOTE_MD5S" | awk -v p="$f" '$2==p {print $1}')
  if [[ -z "$REMOTE_MD5" ]]; then
    echo "  + 로컬에만 있음(운영 미반영): $f"; DIFF_COUNT=$((DIFF_COUNT+1))
  elif [[ "$REMOTE_MD5" != "$LOCAL_MD5" ]]; then
    echo "  ≠ 다름: $f"; DIFF_COUNT=$((DIFF_COUNT+1))
  fi
done < /tmp/pf-files.txt
rm -f /tmp/pf-files.txt

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
