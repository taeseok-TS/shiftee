#!/usr/bin/env python3
"""큐브티 앱 밖 감시 (2026-09-04, 검증관 C M-2)

왜 필요한가: 지금까지 모든 알림은 **앱 자신이** 봇 DM 으로 보냈다. 그러면 앱이 죽는
순간 알림도 같이 죽는다 — 가장 알려야 할 때 가장 조용해진다. 이 스크립트는 도커 밖
호스트에서 돌고, 메일(SMTP)로 알린다. 앱과 DB 가 둘 다 죽어도 알림은 나간다.

서로 감시한다: 이 스크립트는 /var/log/caddy/.watchdog-beat 에 신호를 남기고
(그 디렉터리는 앱 컨테이너에 읽기전용으로 붙어 있다), 앱은 그 신호가 낡으면
"감시가 멈췄다"고 알린다. 한쪽이 죽으면 다른 쪽이 말한다.
"""
import json, os, socket, ssl, subprocess, sys, time, urllib.request, urllib.error
from email.message import EmailMessage
import smtplib

# --dry-run: 진단·시험용. 판정은 그대로 하되 **메일 발송과 컨테이너 재시작만** 하지 않는다.
# 이 스위치를 스크립트 안에 둔 이유: 밖에서 sed 로 치환해 시험하다가 치환이 조용히 실패해
# 실제 재시작과 오탐 메일이 나간 적이 있다(2026-09-04). 시험 수단은 코드 안에 있어야 안전하다.
# --state-dir 로 상태 파일을 따로 두면 운영 상태를 건드리지 않고 여러 회차를 돌려볼 수 있다.
DRY = "--dry-run" in sys.argv
_sd = None
for _i, _a in enumerate(sys.argv):
    if _a == "--state-dir" and _i + 1 < len(sys.argv):
        _sd = sys.argv[_i + 1]

URL       = "https://cubetee.co.kr/api/health-deep"
for _i, _a in enumerate(sys.argv):
    if _a == "--url" and _i + 1 < len(sys.argv):
        URL = sys.argv[_i + 1]
ENV       = "/opt/qubetee/.env"
STATE_DIR = _sd or "/var/lib/qubetee-watchdog"
STATE     = os.path.join(STATE_DIR, "state.json")
RECIP     = os.path.join(STATE_DIR, "recipients.json")
BEAT      = os.path.join(STATE_DIR, "beat") if _sd else "/var/log/caddy/.watchdog-beat"  # 앱이 읽는다(ro 마운트)
FAIL_N    = 3        # 연속 3회(=3분) 실패해야 알린다 — 배포 중 재시작을 장애로 오인하지 않게
REPEAT_N  = 30       # 계속 죽어 있으면 30분마다 다시 알린다
RESTART_COOLDOWN = 1800  # 자동 재시작은 30분에 한 번까지


def env():
    d = {}
    try:
        with open(ENV) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    d[k.strip()] = v.strip().strip('"').strip("'")
    except Exception:
        pass
    return d


def load(path, default):
    try:
        with open(path) as f:
            return json.load(f)
    except Exception:
        return default


def save(path, obj):
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        tmp = path + ".tmp"
        with open(tmp, "w") as f:
            json.dump(obj, f)
        os.replace(tmp, path)   # 쓰다 죽어도 반쪽 파일이 남지 않게
    except Exception as e:
        print("state 저장 실패:", e, file=sys.stderr)


def brief(text):
    """응답 본문을 사람이 읽을 만큼만. 오류 화면이 HTML 이면 통째로 메일에 실려 읽을 수 없었다."""
    t = " ".join(text.split())
    if t.startswith("<"):
        t = "(HTML 오류 화면)"
    return t[:120]


def probe():
    """(ok, 설명) — 앱이 DB 까지 정상인지 본다."""
    try:
        req = urllib.request.Request(URL, headers={"User-Agent": "qubetee-watchdog"})
        with urllib.request.urlopen(req, timeout=10) as r:
            body = r.read(500).decode("utf8", "replace")
            if r.status == 200 and '"ok":true' in body.replace(" ", ""):
                return True, "정상"
            return False, f"HTTP {r.status} {brief(body)}"
    except urllib.error.HTTPError as e:
        detail = ""
        try:
            detail = e.read(300).decode("utf8", "replace")
        except Exception:
            pass
        return False, f"HTTP {e.code} {brief(detail)}"
    except (urllib.error.URLError, socket.timeout, TimeoutError) as e:
        return False, f"연결 실패: {e}"
    except Exception as e:
        return False, f"확인 실패: {e}"


def recipients(e):
    """수신자는 DB(관리자 설정)를 따른다. DB 가 죽어 있을 때를 대비해 캐시를 쓴다."""
    try:
        ids = subprocess.run(
            ["docker", "exec", "qubetee-db-1", "psql", "-U", e.get("POSTGRES_USER", "postgres"),
             "-d", e.get("POSTGRES_DB", "shiftee"), "-t", "-A", "-c",
             "SELECT u.email FROM \"User\" u WHERE u.email IS NOT NULL AND u.id IN ("
             "SELECT jsonb_array_elements_text(value::jsonb) FROM \"AppSetting\" "
             "WHERE key='notifyTargets.system')"],
            capture_output=True, text=True, timeout=15)
        got = [x.strip() for x in ids.stdout.splitlines() if "@" in x]
        if got:
            save(RECIP, got)
            return got
    except Exception:
        pass
    return load(RECIP, [])   # DB 가 안 되면 마지막으로 성공했을 때의 명단


def send_mail(e, to, subject, body):
    if DRY:
        print("[dry-run] 메일 발송 안 함 →", to)
        print("  제목:", subject)
        for _ln in body.splitlines():
            print("  " + _ln)
        return True
    if not to:
        print("수신자를 알 수 없어 메일을 못 보냅니다", file=sys.stderr)
        return False
    msg = EmailMessage()
    msg["From"] = f"{e.get('SMTP_FROM_NAME','큐브티')} <{e.get('SMTP_FROM_EMAIL','no-reply@cubetee.co.kr')}>"
    msg["To"] = ", ".join(to)
    msg["Subject"] = subject
    msg.set_content(body)
    try:
        with smtplib.SMTP(e.get("SMTP_HOST", ""), int(e.get("SMTP_PORT", "587")), timeout=20) as s:
            s.starttls(context=ssl.create_default_context())
            s.login(e.get("SMTP_USER", ""), e.get("SMTP_PASS", ""))
            s.send_message(msg)
        return True
    except Exception as ex:
        print("메일 발송 실패:", ex, file=sys.stderr)
        return False


def main():
    e = env()
    st = load(STATE, {"fails": 0, "alerted": False, "restartedAt": 0, "lastOk": 0})
    ok, why = probe()
    now = int(time.time())

    # 신호를 남긴다 — 앱이 이 파일의 나이를 보고 "감시가 멈췄다"를 판정한다.
    try:
        os.makedirs(os.path.dirname(BEAT), exist_ok=True)
        with open(BEAT, "w") as f:
            f.write(json.dumps({"at": now, "ok": ok, "why": why}))
    except Exception as ex:
        print("beat 쓰기 실패:", ex, file=sys.stderr)

    if ok:
        if st.get("alerted"):
            down = now - int(st.get("lastOk") or now)
            send_mail(e, recipients(e), "[큐브티] 서비스 복구됨",
                      f"앱이 다시 정상 응답합니다.\n\n중단 추정 시간: 약 {down // 60}분\n확인 주소: {URL}\n시각: {time.strftime('%Y-%m-%d %H:%M:%S')}\n")
        st.update({"fails": 0, "alerted": False, "lastOk": now})
        recipients(e)   # 정상일 때 명단을 갱신해 둔다(장애 중에는 DB 를 못 볼 수 있다)
        save(STATE, st)
        return 0

    st["fails"] = int(st.get("fails", 0)) + 1
    n = st["fails"]
    print(f"실패 {n}회: {why}", file=sys.stderr)

    # 연속 실패가 기준을 넘으면 한 번 되살려 본다(쿨다운 30분)
    if n == FAIL_N and now - int(st.get("restartedAt", 0)) > RESTART_COOLDOWN:
        try:
            if DRY:
                print("[dry-run] 재시작 안 함 (docker compose restart web 을 불렀을 자리)")
            else:
                subprocess.run(["docker", "compose", "restart", "web"], cwd="/opt/qubetee",
                               capture_output=True, timeout=120)
                print("web 컨테이너를 재시작했습니다", file=sys.stderr)
            st["restartedAt"] = now
        except Exception as ex:
            print("재시작 실패:", ex, file=sys.stderr)

    if n >= FAIL_N and (not st.get("alerted") or n % REPEAT_N == 0):
        body = (f"큐브티 앱이 응답하지 않습니다.\n\n증상: {why}\n연속 실패: {n}회(1분 간격)\n"
                f"확인 주소: {URL}\n시각: {time.strftime('%Y-%m-%d %H:%M:%S')}\n\n"
                f"자동 재시작: {'시도함' if st.get('restartedAt') else '안 함'}\n"
                "이 메일은 서버(도커 밖)에서 직접 보냅니다 — 앱이 죽어도 발송됩니다.\n")
        if send_mail(e, recipients(e), "[큐브티] 🔴 서비스 응답 없음", body):
            st["alerted"] = True
    save(STATE, st)
    return 1


if __name__ == "__main__":
    sys.exit(main())
