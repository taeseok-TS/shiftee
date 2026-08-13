# syntax=docker/dockerfile:1
# ─────────────────────────────────────────────────────────────
# 큐브티(Cubetee) 단일 VPS 배포용 Dockerfile
# pnpm 워크스페이스 모노레포 → apps/web(Next.js)를 빌드/실행
# ─────────────────────────────────────────────────────────────

####################  Base  ####################
FROM node:24-slim AS base
# Prisma 는 OpenSSL, 한글 PDF 생성은 나눔폰트, 대용량 영상 자동 압축은 ffmpeg 필요
RUN apt-get update -y \
  && apt-get install -y --no-install-recommends openssl ca-certificates fonts-nanum ffmpeg \
  && rm -rf /var/lib/apt/lists/*
# pnpm 을 직접 전역 설치 (lockfileVersion 9.0 호환 → pnpm 10)
RUN npm install -g pnpm@10
WORKDIR /app
# engines.pnpm(>=11) 강제 검사 비활성화: lockfile 9.0 기준 pnpm 10으로 설치
RUN printf 'engine-strict=false\n' > /app/.npmrc

####################  Build  ####################
FROM base AS build
# 1) 매니페스트만 먼저 복사해 의존성 설치 레이어 캐시
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json        apps/web/package.json
COPY apps/mobile/package.json     apps/mobile/package.json
COPY packages/api/package.json    packages/api/package.json
COPY packages/db/package.json     packages/db/package.json
COPY packages/shared/package.json packages/shared/package.json
# postinstall(prisma generate)은 아직 스키마가 없으므로 스킵
# --no-frozen-lockfile: lockfile이 package.json과 약간 어긋나도 해석해 설치(배포 빌드용)
RUN pnpm install --no-frozen-lockfile --ignore-scripts

# 2) 전체 소스 복사 (.dockerignore 로 node_modules/.next/uploads 제외)
COPY . .

# 3) 링크용 주소(APP_URL/API_URL)는 런타임에 주입한다 — 빌드에 박지 않아야
#    한 번 만든 이미지를 고객사마다 그대로 쓸 수 있다(deploy/README.md 참고).

# 4) 공유 패키지 빌드 → Prisma 클라이언트 생성 → 웹 빌드
#    실제 사용되는 스키마는 apps/web/prisma/schema.prisma (기본 위치)
RUN pnpm --filter @shiftee/api build
RUN pnpm --filter web exec prisma generate
RUN pnpm --filter web build

####################  Runtime  ####################
FROM base AS runner
ENV NODE_ENV=production
# 한글 PDF 폰트 (signed-document 라우트가 FONT_PATH 사용)
ENV FONT_PATH=/usr/share/fonts/truetype/nanum/NanumGothic.ttf
WORKDIR /app
# 빌드 산출물 + node_modules(pnpm 심볼릭링크 보존) 통째로 복사
COPY --from=build /app ./
# 업로드 저장 위치 (process.cwd()/uploads → /app/apps/web/uploads)
RUN mkdir -p /app/apps/web/uploads
EXPOSE 3000
WORKDIR /app/apps/web
# next start (apps/web 의 start 스크립트)
CMD ["pnpm", "start"]
