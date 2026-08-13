# 고객사 설치 키트

판매용 인스턴스를 만들고 운영하는 도구. **직영 운영(루트 `docker-compose.yml`)에는 영향이 없다.**

> **실측 검증 완료 (2026-08-13, 운영 서버)** — 설치 **11초**, 롤백 정상, 브라우저 로그인·지점 등록·
> 출퇴근·휴가 신청까지 새 인스턴스에서 동작 확인. 직영(3000)에 영향 없음.
> 검증 절차는 아래 「설치 검증」 참고.

| 파일 | 역할 |
|---|---|
| `new-customer.sh` | 신규 고객사 원커맨드 설치 |
| `docker-compose.customer.yml` | 고객사 1곳용 compose (빌드 대신 이미지 사용, 포트 파라미터) |
| `init-tenant.js` | 빈 DB에 관리자 1명만 생성 (`prisma/seed.ts`는 개발용이라 쓰면 안 됨) |

---

## ✅ 한 번 빌드, 여러 곳 배포 — 완료 (2026-08-13)

`NEXT_PUBLIC_*` 는 빌드 시점에 코드로 박히기 때문에 도메인이 이미지에 구워졌고, 그래서
고객사마다 이미지를 새로 빌드해야 했다. **링크 생성 6곳이 전부 서버 라우트라 런타임 변수로 전환했다.**

| 변수 | 조치 | 상태 |
|---|---|---|
| `NEXT_PUBLIC_APP_URL` (6곳) | `lib/app-url.ts` 의 `getAppUrl()` 로 통일 → 런타임 `APP_URL` | 완료 |
| `NEXT_PUBLIC_API_URL` (1곳) | `API_URL` 로 변경. 단 `lib/api-client.ts` 는 **참조하는 곳이 없는 파일** | 완료 |
| `NEXT_PUBLIC_KAKAO_MAP_API_KEY` (2곳) | 그대로 둔다 | 유지 |

`Dockerfile` 의 `ARG/ENV NEXT_PUBLIC_*` 는 제거했고, 직영 `docker-compose.yml` 은
`APP_URL: ${APP_URL:-${NEXT_PUBLIC_APP_URL}}` 로 주입한다(기존 `.env` 를 고치지 않아도 되게 fallback).

**값이 없으면 조용히 `localhost` 로 떨어지지 않는다.** `getAppUrl()` 이 프로세스당 한 번 경고를 남긴다.

**실측 검증 (검증 인스턴스 `APP_URL=https://mail.test` 로 메일을 실제 발송해 본문 캡처):**

| 링크 | 실제 발송 문자열 |
|---|---|
| 휴가 결재 알림 | `https://mail.test/leave` |
| 계약서 발송 메일 | `https://mail.test/contracts` |
| 계약 서명(다음 결재자) | `https://mail.test/contracts` |
| 화상회의 초대 | `https://cubetee.co.kr/work/meeting?join=…` (운영 DM 실물) |

이미지에 박힌 값이 아니라 **인스턴스마다 다른 주소**가 나온 것이 전환이 실제로 먹었다는 증거다.
`localhost` 유출 0건.

> `NEXT_PUBLIC_KAKAO_MAP_API_KEY` 를 `KAKAO_REST_API_KEY` 로 바꾸자는 기존 제안은 **적용하면 안 된다.**
> `geocodeAddress()` 호출부인 `app/admin/branches/page.tsx` 가 `"use client"` 라 브라우저에서 실행된다.
> 이름을 바꾸면 주소→좌표 변환이 죽는다. (키가 번들에 노출되는 것은 카카오 JS 키의 정상 사용 형태다.)

---

## 사용법

```bash
# 0) 이미지 한 번 빌드 (버전 태그를 붙일 것)
cd /opt/qubetee
docker build -t cubetee:1.0.0 .
# 직영과 같은 소스로 이미 빌드해 뒀다면 태그만 붙여도 된다: docker tag qubetee-web:latest cubetee:1.0.0

# 1) 고객사 생성  (Windows에서 옮긴 파일은 실행비트가 없으므로 bash 로 실행)
cd /opt/qubetee/deploy
bash new-customer.sh \
  --code acme \
  --domain hr.acme.co.kr \
  --port 3101 \
  --email admin@acme.co.kr \
  --name "홍길동" \
  --branch "본점" \
  --image cubetee:1.0.0
```

생성 위치는 `/opt/cubetee/customers/<code>/` (환경변수 `CUBETEE_BASE_DIR` 로 변경 가능).
초기 비밀번호는 `접속정보.txt`(권한 600)에 저장된다.

**포트 배정 규칙** — 직영이 3000이므로 고객사는 3101부터 순서대로 쓴다.

### 설치 후 수동 작업

1. 리버스 프록시(Nginx/Caddy)에 `도메인 → 127.0.0.1:<port>` + TLS
2. **지점 좌표·반경 수정** — 기본값은 서울시청. 안 고치면 출퇴근 판정이 전부 틀린다
3. 백업 대상에 추가 (아래)

### ⚠️ TLS 전에는 로그인이 안 된다 (정상)

세션 쿠키가 `Secure` 라서 **http 접속에서는 브라우저가 쿠키를 저장하지 않는다.**
로그인 API 는 `200 success` 를 주지만 화면은 로그인되지 않은 상태로 남는다 — 고장이 아니다.
TLS 를 붙이기 전에 먼저 확인하고 싶다면 그 인스턴스만 임시로:

```bash
cd /opt/cubetee/customers/<code>
COOKIE_SECURE=false docker compose -p cubetee-<code> -f docker-compose.customer.yml up -d web
```

확인이 끝나면 옵션 없이 다시 `up -d web` 해서 원상복구한다(.env 는 그대로 true).

### 설치 검증 (실측 절차)

설치 직후 이 순서로 확인한다. 아래는 2026-08-13 운영 서버에서 실제로 통과한 절차다.

```bash
B=http://127.0.0.1:<port>; J=/tmp/chk.jar
curl -s -c $J -X POST $B/api/auth/login -H "Content-Type: application/json" \
  -d '{"email":"<관리자메일>","password":"<접속정보.txt의 비밀번호>"}'
curl -s -b $J -X POST $B/api/branches -H "Content-Type: application/json" \
  -d '{"name":"테스트지점","address":"주소","latitude":37.4979,"longitude":127.0276,"radius":300}'
curl -s -b $J -X POST $B/api/attendance/clock-in -H "Content-Type: application/json" \
  -d '{"latitude":37.5665,"longitude":126.978}'     # 지점 좌표와 같아야 지오펜스 통과
curl -s -b $J -X POST $B/api/leave -H "Content-Type: application/json" \
  -d '{"type":"ANNUAL","startDate":"2026-09-01","endDate":"2026-09-01","reason":"설치검증"}'
```

넷 다 `success:true` 면 스키마·세션·지오펜스·연차계산이 모두 살아 있는 것이다.
마지막으로 브라우저에서 로그인 → 대시보드가 뜨는지 본다(위 TLS 주의 참고).

**롤백 확인** — 일부러 실패시켜 정리가 도는지 본다. 잘못된 이미지를 주면 스키마 생성 단계에서 죽는다.

```bash
bash new-customer.sh --code rolltest --domain roll.test --port 3198 --email a@b.kr --image postgres:16-alpine
docker ps -a --filter name=cubetee-rolltest -q | wc -l   # 0 이어야 정상
docker volume ls --filter name=cubetee-rolltest -q | wc -l # 0 이어야 정상
rm -rf /opt/cubetee/customers/rolltest                     # 디렉터리는 일부러 남는다
```

---

## 운영

### 업데이트 배포 (전 고객사)

```bash
docker build -t cubetee:1.1.0 /opt/qubetee
for d in /opt/cubetee/customers/*/; do
  code=$(basename "$d")
  sed -i "s|^CUBETEE_IMAGE=.*|CUBETEE_IMAGE=cubetee:1.1.0|" "$d/.env"
  (cd "$d" && docker compose -p "cubetee-$code" -f docker-compose.customer.yml up -d web)
done
```

**스키마가 바뀌었으면** 각 인스턴스에 `db push` 를 먼저 돌린다.

```bash
(cd "$d" && docker compose -p "cubetee-$code" -f docker-compose.customer.yml \
   run --rm --no-deps -T web pnpm exec prisma db push --skip-generate)
```

> ⚠️ **한 곳에서 먼저 검증하고 전체에 돌릴 것.** 회귀 테스트가 아직 없다(과제목록 P1-6).

### 백업

각 인스턴스의 `backup/` 이 컨테이너 `/backup` 에 마운트돼 있다. 호스트 crontab에 추가:

```bash
0 19 * * * for d in /opt/cubetee/customers/*/; do code=$(basename "$d"); \
  docker exec "cubetee-${code}-db-1" pg_dump -U postgres cubetee \
  | gzip > "$d/backup/$(date +\%F).sql.gz"; \
  find "$d/backup" -name '*.sql.gz' -mtime +14 -delete; done
```

직영과 마찬가지로 **오프사이트 사본과 복구 테스트**가 있어야 완성이다.

### 제거

```bash
cd /opt/cubetee/customers/<code>
docker compose -p cubetee-<code> -f docker-compose.customer.yml down -v   # -v = 데이터 삭제
```

`-v` 는 되돌릴 수 없다. **백업을 먼저 확보할 것.**

---

## 알아둘 것

- **migrations 이력이 없다.** 이 프로젝트는 `db push` 로만 관리해 왔다. 빈 DB에는 안전하지만,
  운영 DB는 수동 DDL로 관리돼 왔으므로 운영 스키마와 `schema.prisma` 가 어긋나 있다. 대조 명령:

  ```bash
  docker exec -w /app/apps/web qubetee-web-1 sh -c \
    'pnpm exec prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --script'
  ```

  **2026-08-13 대조 결과 — 차이 30건.** 고객사는 `schema.prisma` 기준으로 만들어지므로 아래는
  "직영은 되는데 고객사는 안 되는(또는 그 반대)" 후보다.

  | 구분 | 내용 | 영향 |
  |---|---|---|
  | 운영에만 있는 컬럼 | `User.canViewPayroll`, `User.monthlySalary` | **급여 기능 배포 시 고객사에서 즉시 오류.** 급여 기능을 살릴 때 `schema.prisma` 에 먼저 반영해야 한다 |
  | FK 삭제규칙 불일치 | `ContractApprovalStep.approverId` — 운영 `RESTRICT` / 스키마 `SET NULL` | 결재자로 지정된 직원 삭제 시 **운영은 차단, 고객사는 approverId 를 NULL 처리**. 동작이 갈린다 |
  | FK 재생성 항목 | Work* 계열 다수 (CASCADE 동일) | 실동작 차이 없음(정의 순서/이름 정규화) |
  | `updatedAt` DB DEFAULT | AppSetting·BotBriefing·PushToken·Suggestion·VideoCompressJob | 앱은 Prisma로만 쓰므로 무해. 수동 INSERT 시에만 차이 |
  | 인덱스 | 운영에만 `Contract_bundleId_idx` | 성능만, 무해 |

  > 운영 DB를 스키마에 맞추는 것은 **별건**이다. 위 SQL을 그대로 돌리면 급여 컬럼이 삭제되므로
  > 절대 자동 적용하지 말 것.
- 인스턴스마다 컨테이너·볼륨이 따로 생긴다(compose 프로젝트명으로 격리). 데이터는 서로 보이지 않는다.
- 한 서버에 몇 곳까지 올릴지는 메모리 기준으로 잡는다. 인스턴스당 web+db 약 1GB 내외.
