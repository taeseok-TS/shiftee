#!/bin/bash

# 모든 기존 프로세스 종료
echo "🛑 기존 서버 종료 중..."
ps aux | grep -E "[n]ext|[n]pm run dev" | awk '{print $2}' | xargs -r kill -9 2>/dev/null

# 캐시 정리
echo "🧹 캐시 정리 중..."
rm -rf apps/web/.next
find . -name "*.lock" -delete 2>/dev/null

# 잠시 대기
sleep 3

# 서버 시작
echo "🚀 서버 시작..."
cd apps/web
npm run dev
