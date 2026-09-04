# 앱 밖 감시 (워치독)

앱이 죽으면 앱이 보내는 알림도 같이 죽는다. 이 워치독은 **도커 밖 호스트**에서
1분마다 앱을 찌르고, 이상하면 **메일**로 알린다. 앱과 DB 가 둘 다 죽어도 발송된다.

## 설치
```sh
install -m755 qubetee-watchdog.py /usr/local/sbin/qubetee-watchdog.py
install -m644 qubetee-watchdog.service /etc/systemd/system/
install -m644 qubetee-watchdog.timer   /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now qubetee-watchdog.timer
```

## 시험 (실제 재시작·발송 없이)
```sh
python3 /usr/local/sbin/qubetee-watchdog.py --dry-run --state-dir /tmp/wdt \
        --url https://cubetee.co.kr/api/__nope__
```
`--dry-run` 은 **판정은 그대로 하되** 메일 발송과 컨테이너 재시작만 건너뛴다.
`--state-dir` 로 운영 상태 파일을 건드리지 않는다.

> ⚠ 이 스위치가 스크립트 **안에** 있는 이유: 밖에서 sed 로 치환해 시험하다가
> 치환이 조용히 실패해 실제 재시작과 오탐 메일이 나간 적이 있다(2026-09-04).
> 시험 수단은 코드 안에 있어야 한다.

## 서로 감시
워치독은 `/var/log/caddy/.watchdog-beat` 에 신호를 남긴다(그 디렉터리는 web 컨테이너에
읽기전용으로 붙어 있다). 앱의 매시 점검은 그 신호가 15분 넘게 낡으면 알린다.
한쪽이 죽으면 다른 쪽이 말한다.

## 판정 기준
- 확인 주소: `/api/health-deep` — DB 까지 실제로 만진다(`/api/health-beat` 은 Next 가
  응답한다는 것만 증명해서, **DB 가 죽어도 정상으로 보였다**).
- 연속 3회(=3분) 실패해야 알린다 — 배포 중 재시작을 장애로 오인하지 않게.
- 3회째에 컨테이너 재시작 1회(쿨다운 30분), 계속 죽어 있으면 30분마다 재알림, 복구 시 복구 메일.
- 수신자는 DB 의 관리자 설정(`notifyTargets.system`)을 따르고, DB 가 죽었을 때를 위해 캐시한다.
