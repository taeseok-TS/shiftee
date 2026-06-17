# 큐브티(Qubetee) 배포 가이드 — 단일 VPS + Docker

이 문서는 큐브티를 **온라인 서버(VPS) 1대**에 Docker 로 올리는 최소 절차를 설명합니다.
약 200명 동시 사용까지는 이 구성으로 충분합니다.

---

## 1. 준비물

- **VPS 1대** (예: Vultr / DigitalOcean / 네이버클라우드 / AWS Lightsail)
  - 권장 사양: **vCPU 2 / RAM 4GB / SSD 40GB** 이상 (Ubuntu 22.04 또는 24.04)
- **도메인** (선택, 없으면 서버 IP 로도 가능)
- 서버에 **Docker** 와 **Docker Compose** 설치

### Docker 설치 (Ubuntu)

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER   # 로그아웃 후 재접속하면 sudo 없이 docker 사용
```

설치 확인:

```bash
docker --version
docker compose version
```

---

## 2. 소스 올리기

로컬에서 git 으로 관리 중이면 서버에서 clone, 아니면 압축해서 업로드합니다.

```bash
# 예: git 사용 시
git clone <레포주소> qubetee
cd qubetee
```

> `node_modules`, `.next`, `apps/web/uploads` 는 올릴 필요 없습니다(빌드 시 생성/볼륨 보존).

---

## 3. 환경변수 설정

예시 파일을 복사해 실제 값을 채웁니다.

```bash
cp .env.docker.example .env
nano .env
```

반드시 바꿔야 하는 값:

| 변수 | 설명 |
|------|------|
| `POSTGRES_PASSWORD` | DB 비밀번호 (강력하게) |
| `JWT_SECRET` | 로그인 토큰 서명 키. `openssl rand -base64 48` 로 생성 |
| `NEXT_PUBLIC_APP_URL` | 실제 접속 주소 (예: `https://qubetee.example.com`) |
| `NEXT_PUBLIC_API_URL` | 위 주소 + `/api` |

> ⚠️ `NEXT_PUBLIC_*` 값은 **빌드 시점에 화면 코드 안에 박힙니다.** 나중에 주소가 바뀌면
> `docker compose build` 부터 다시 해야 반영됩니다.

---

## 4. 빌드 & 실행

```bash
docker compose up -d --build
```

- 처음 빌드는 5~10분 정도 걸립니다.
- `-d` 는 백그라운드 실행. 로그는 `docker compose logs -f web` 로 확인.

상태 확인:

```bash
docker compose ps
```

---

## 5. 데이터베이스 초기화 (최초 1회)

스키마를 DB 에 반영합니다. (실제 스키마는 `apps/web/prisma/schema.prisma`)

```bash
docker compose exec web pnpm --filter web exec prisma db push
```

초기 계정/지점 시드 데이터가 필요하면(선택, 시드 스크립트가 있을 때):

```bash
docker compose exec web pnpm --filter web exec prisma db seed
```

이제 브라우저에서 `http://서버IP:3000` 으로 접속되면 성공입니다.

---

## 6. 도메인 + HTTPS (권장)

`80/443` 포트를 받아 컨테이너의 `3000` 으로 넘기는 리버스 프록시를 둡니다.
가장 쉬운 방법은 **Caddy** (인증서 자동 발급):

`/etc/caddy/Caddyfile`:

```
qubetee.example.com {
    reverse_proxy localhost:3000
}
```

```bash
sudo apt install -y caddy
sudo systemctl restart caddy
```

이러면 `https://qubetee.example.com` 으로 자동 HTTPS 접속됩니다.
(Nginx + certbot 으로도 가능)

---

## 7. 운영 명령어 모음

| 작업 | 명령어 |
|------|--------|
| 로그 보기 | `docker compose logs -f web` |
| 재시작 | `docker compose restart web` |
| 중지 | `docker compose down` (볼륨/데이터는 유지) |
| 코드 업데이트 후 재배포 | `git pull && docker compose up -d --build` |
| DB 접속 | `docker compose exec db psql -U postgres -d shiftee` |

### 백업

- **DB 백업**
  ```bash
  docker compose exec db pg_dump -U postgres shiftee > backup_$(date +%F).sql
  ```
- **업로드 파일 백업** — `uploads` 볼륨을 통째로 보관
  ```bash
  docker run --rm -v qubetee_uploads:/data -v $(pwd):/out alpine \
    tar czf /out/uploads_$(date +%F).tar.gz -C /data .
  ```

---

## 8. 지금 구성의 한계 (나중에 확장 시 참고)

현재 코드 특성상 **웹 컨테이너는 1개(단일 프로세스)** 로만 돌려야 합니다.

1. **실시간(SSE) 채팅/알림** 이 메모리(EventEmitter) 기반 → 인스턴스를 늘리면
   사용자마다 다른 인스턴스에 붙어 메시지가 누락됩니다.
   → 다중화하려면 **Redis Pub/Sub** 로 교체 필요.
2. **업로드 파일** 이 로컬 디스크(`uploads` 볼륨) 기반 → 다중 인스턴스/오토스케일이면
   파일이 한 서버에만 존재합니다.
   → 확장 시 **S3 / Cloudflare R2** 같은 오브젝트 스토리지로 이전 필요.

200명 규모에서는 위 두 가지 없이 **VPS 1대 + 컨테이너 1개**로 충분합니다.
사용자가 크게 늘거나 서버를 여러 대로 나눠야 할 때 ①Redis ②오브젝트 스토리지 순으로 도입하면 됩니다.
