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
# 상태.수신자 캐시 예비 위치. fails 카운터가 state.json 에만 살면, 디스크가 차거나
# 파일시스템이 읽기전용이 되는 순간 매 실행이 n=1 에서 시작해 n >= 3 이 영영 안 되고
# **알림이 0통**이 된다. 그런데 디스크 풀.RO 야말로 이 워치독이 잡아야 할 대표적 장애다
# — 원인이 생긴 바로 그 순간 감시가 조용해진다(2026-09-04 검증관 A W-1, 치명).
FALLBACK_STATE = "/run/qubetee-watchdog-state.json"
# ⚠ --dry-run 만 주고 --state-dir 을 잊으면, 발송.재시작은 건너뛰면서도 **운영 상태 파일은
#   그대로 고쳤다** — dry-run 3회면 재시작 쿨다운이 30분 잠겨 진짜 장애 때 자동복구가 안 나간다
#   (검증관 A W-2). 안전이 "두 번째 플래그를 기억하는 것"에 걸려 있으면 안 된다.
if DRY and not _sd:
    import tempfile
    _sd = tempfile.mkdtemp(prefix="qubetee-wd-dry-")

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
MAIL_GAP  = 600      # ⚠ 어떤 메일이든 최소 이 간격을 둔다. 종전에는 복구 메일에 쿨다운이
                     #   없어, 4분 주기로 흔들리는 서비스가 시간당 약 30통을 보냈다
                     #   (경고 15 + 복구 15, 2026-09-04 검증관 A W-4). 폭주하는 알림은
                     #   안 오는 알림만큼 나쁘다 — 사람이 곧바로 무시하게 된다.
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
    for target in (path, FALLBACK_STATE if path == STATE else None):
        if not target:
            continue
        try:
            with open(target) as f:
                return json.load(f)
        except Exception:
            continue
    return default


def save(path, obj):
    """상태를 남긴다. 실패하면 False — 호출부는 그걸 **장애로 취급**해야 한다(W-1)."""
    for target in (path, FALLBACK_STATE if path == STATE else None):
        if not target:
            continue
        try:
            os.makedirs(os.path.dirname(target), exist_ok=True)
            tmp = target + ".tmp"
            with open(tmp, "w") as f:
                json.dump(obj, f)
            os.replace(tmp, target)   # 쓰다 죽어도 반쪽 파일이 남지 않게
            return True
        except Exception as e:
            print("state 저장 실패(%s): %s" % (target, e), file=sys.stderr)
    return False


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


# 최후 폴백 수신자. DB 도 캐시도 못 읽는 상황이 바로 알려야 할 상황인데, 종전에는
# 그때 수신자가 [] 가 되어 **알림이 통째로 사라졌다**(검증관 A W-5).
FALLBACK_TO = ["admin@cubetee.co.kr"]


def send_mail(e, to, subject, body):
    if not to:
        to = FALLBACK_TO
        print("수신자를 알 수 없어 기본 주소로 보냅니다:", to, file=sys.stderr)
    if DRY:
        print("[dry-run] 메일 발송 안 함 →", to)
        print("  제목:", subject)
        for _ln in body.splitlines():
            print("  " + _ln)
        return True
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


# 호스트에서 살아 있어야 하는 것들. 죽어도 앱은 멀쩡히 응답하므로 **아무도 모른다**
# — 방화벽이 내려가면 포트 3000 이 외부에 열리고, fail2ban 이 내려가면 무제한으로 두드려진다
# (2026-09-04 검증관 C B-4). 감시가 이미 여기 있으니 함께 본다.
GUARD_UNITS = ["fail2ban.service", "qubetee-firewall.timer", "docker.service"]


def dead_units():
    out = []
    for u in GUARD_UNITS:
        try:
            r = subprocess.run(["systemctl", "is-active", u], capture_output=True, text=True, timeout=10)
            if r.stdout.strip() != "active":
                out.append("%s(%s)" % (u, r.stdout.strip() or "unknown"))
        except Exception as ex:
            out.append("%s(확인실패: %s)" % (u, ex))
    return out


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
        # 복구를 알리되, 직전 메일과 너무 붙으면 참는다(플래핑 폭주 방지).
        if st.get("alerted") and now - int(st.get("lastMailAt", 0)) >= MAIL_GAP:
            st["lastMailAt"] = now
            down = now - int(st.get("lastOk") or now)
            send_mail(e, recipients(e), "[큐브티] 서비스 복구됨",
                      f"앱이 다시 정상 응답합니다.\n\n중단 추정 시간: 약 {down // 60}분\n확인 주소: {URL}\n시각: {time.strftime('%Y-%m-%d %H:%M:%S')}\n")
        # 앱이 정상일 때만 본다 — 앱 장애 알림과 뒤섞으면 정작 급한 것이 묻힌다.
        dead = dead_units()
        if dead and now - int(st.get("guardMailAt", 0)) >= 6 * 3600:
            st["guardMailAt"] = now
            send_mail(e, recipients(e), "[큐브티] 🟠 서버 보호 장치가 멈췄습니다", chr(10).join([
                "다음이 동작하지 않습니다: " + ", ".join(dead), "",
                "fail2ban 이 멈추면 SSH 가 무제한으로 두드려지고,",
                "방화벽 타이머가 멈추면 앱 포트(3000)가 외부에 열릴 수 있습니다.",
                "systemctl status <유닛> 으로 확인해 주십시오.", ""]))
        elif not dead:
            st.pop("guardMailAt", None)
        st.update({"fails": 0, "alerted": False, "lastOk": now})
        if not DRY:
            recipients(e)   # 정상일 때 명단을 갱신해 둔다(장애 중에는 DB 를 못 볼 수 있다)
        if not save(STATE, st) and not st.get("stateAlerted"):
            st["stateAlerted"] = True
            send_mail(e, recipients(e), "[큐브티] 🟠 감시 상태 저장 실패", chr(10).join([
                "워치독이 상태 파일을 쓰지 못하고 있습니다(디스크 가득 참 또는 읽기전용 가능성).",
                "이 상태에서는 장애가 나도 연속 실패를 셀 수 없어 알림이 안 나갑니다.",
                "서버 디스크와 /var/lib/qubetee-watchdog 권한을 확인해 주십시오.", ""]))
        return 0

    st["fails"] = int(st.get("fails", 0)) + 1
    n = st["fails"]
    print(f"실패 {n}회: {why}", file=sys.stderr)

    # 연속 실패가 기준을 넘으면 한 번 되살려 본다(쿨다운 30분)
    # ⚠ 종전에는 `n == FAIL_N`(등호)이라 **장애당 정확히 1회**만 시도했다. 그 한 번이 실패해도
    #   두 번 다시 안 했고, 쿨다운은 "다음 장애의 유일한 재시작을 막는" 역방향으로만 작동했다
    #   (검증관 A W-3). `>=` 로 바꿔 쿨다운이 제 일을 하게 한다.
    if n >= FAIL_N and now - int(st.get("restartedAt", 0)) > RESTART_COOLDOWN:
        try:
            if DRY:
                print("[dry-run] 재시작 안 함 (docker compose restart web 을 불렀을 자리)")
                st["restartedAt"] = now
            else:
                r = subprocess.run(["docker", "compose", "restart", "web"], cwd="/opt/qubetee",
                                   capture_output=True, timeout=120)
                # ⚠ 반환코드를 안 보면 **실패한 재시작도 성공으로 기록**되고 메일에는
                #   "자동 재시작: 시도함" 이 찍힌다.
                if r.returncode == 0:
                    st["restartedAt"] = now
                    print("web 컨테이너를 재시작했습니다", file=sys.stderr)
                else:
                    print("재시작 실패 rc=%s" % r.returncode, file=sys.stderr)
        except Exception as ex:
            print("재시작 실패:", ex, file=sys.stderr)

    if n >= FAIL_N and (not st.get("alerted") or n % REPEAT_N == 0)             and now - int(st.get("lastMailAt", 0)) >= MAIL_GAP:
        st["lastMailAt"] = now
        body = (f"큐브티 앱이 응답하지 않습니다.\n\n증상: {why}\n연속 실패: {n}회(1분 간격)\n"
                f"확인 주소: {URL}\n시각: {time.strftime('%Y-%m-%d %H:%M:%S')}\n\n"
                f"자동 재시작: {'시도함' if st.get('restartedAt') else '안 함'}\n"
                "이 메일은 서버(도커 밖)에서 직접 보냅니다 — 앱이 죽어도 발송됩니다.\n")
        if send_mail(e, recipients(e), "[큐브티] 🔴 서비스 응답 없음", body):
            st["alerted"] = True
    if not save(STATE, st):
        # 상태를 못 남기면 다음 실행이 n=1 로 되돌아간다 → 이번 판을 놓치면 영영 못 알린다.
        # 세지 못하는 대신 **지금 바로** 알린다(중복은 감수한다 — 무음보다 낫다).
        send_mail(e, recipients(e), "[큐브티] 🔴 서비스 응답 없음 (상태 기록 불가)", chr(10).join([
            "앱이 응답하지 않는데 워치독이 상태 파일도 쓰지 못합니다.",
            "연속 실패를 셀 수 없어 이 메일이 반복될 수 있습니다.", "", "증상: " + why, ""]))
    # ⚠ 0 을 돌려준다. 앱이 죽은 것은 **이 유닛의 실패가 아니다** — 감지하고 알렸으면 제 할
    #   일을 한 것이다. 유닛은 이제 0 만 성공으로 보므로(W-8), 여기서 1 을 주면 정상 동작이
    #   `systemctl --failed` 에 쌓여 진짜 고장과 구분이 안 된다. 스크립트 자체가 터지면
    #   파이썬이 exit 1 을 내고 그건 실패로 잡힌다.
    return 0


if __name__ == "__main__":
    sys.exit(main())
