# EAS 채널 운영 규칙 (2026-09-05)

| 프로필 | 배포 형식 | 채널 | 누가 받나 |
|---|---|---|---|
| `production` | store | `production` | 앱스토어·플레이스토어 **전 직원** |
| `testflight` | store (TestFlight 제출) | `preview` | **디렉터 검증용** TestFlight |
| `preview` | internal (APK/ad-hoc) | `preview` | 개발 확인용 |

## OTA 내보내는 순서
1. `eas update --branch preview --message "..."` → TestFlight 앱에서 실기기 확인
2. 이상 없으면 `eas update --branch production --message "..."` → 전 직원

## 왜 이렇게 나눴나
2026-09-05 반려 기능 검증 때, TestFlight 빌드가 전부 `production` 채널이라 preview OTA 를
받지 못했다. "실기기에서 눌러보고 내보내자"가 구조적으로 불가능한 상태였다. TestFlight 는
검증 채널(`preview`)로 고정한다. 스토어 심사용 바이너리는 반드시 `production` 프로필로 만든다.

## 주의
- runtimeVersion 정책이 `appVersion` 이라 app.json 의 version 이 같아야 OTA 가 붙는다.
  네이티브 변경 없이 version 만 올리면 기존 앱은 OTA 를 못 받는다.
- 두 프로필 모두 `autoIncrement` 라 빌드 번호가 같은 카운터를 쓴다 — 충돌 없음.
