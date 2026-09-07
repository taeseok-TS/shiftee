// 출퇴근 정책 (2026-09-07 디렉터 지시)
//
// 퇴근 가능 시각을 관리자가 정한다. 두 가지를 함께 저장한다:
//  · 사용 여부(체크) — 끄면 시각 제한이 없다
//  · 마감 시각("HH:mm", KST) — 이 시각을 넘으면 그날 퇴근을 찍을 수 없다
//
// 왜 필요한가: 종전에는 자정을 넘기면 퇴근이 **"출근 기록이 없습니다"** 로 막혔다.
// 퇴근할 때 그 순간의 날짜로 출근 기록을 찾는데 자정을 넘기면 날짜가 갈라지기 때문이다.
// 막히는 것 자체는 의도대로지만(디렉터 판단: 자정 넘기면 못 찍는 게 맞다), 메시지가
// 사실과 달라 직원이 무엇을 해야 할지 알 수 없었다. 이제 이유를 정확히 말한다.
import { prisma } from "@/lib/db";

export const CLOCKOUT_LIMIT_KEY = "attendance.clockOutLimit";

/**
 * 평일 근무 상한 — 이 시간을 넘기면 직원이 앱에서 퇴근을 못 찍는다(주 52시간 방어).
 * 넘긴 근무는 다음 날 관리자가 확인을 눌러 **출근 + 이 시간**으로 마감한다.
 *
 * ⚠ 차단 기준과 자동 마감 값은 **반드시 같은 상수**여야 한다. 다르면 마감한 기록이
 *   여전히 상한을 넘어 있거나(또 막힘), 마감이 상한보다 짧아 근무가 깎인다.
 */
export const WEEKDAY_CAP_HOURS = 10.5;
export const WEEKDAY_CAP_MS = WEEKDAY_CAP_HOURS * 60 * 60 * 1000;

export type ClockOutLimit = {
  /** 켜져 있을 때만 시각 제한이 걸린다 */
  enabled: boolean;
  /** "HH:mm" (KST). 이 시각을 **지나면** 퇴근 불가 */
  time: string;
};

/** 값이 없거나 깨졌을 때의 기본값 — 자정 직전까지 허용(= 자정 넘기면 못 찍는다) */
export const DEFAULT_CLOCKOUT_LIMIT: ClockOutLimit = { enabled: true, time: "23:59" };

/** "HH:mm" 형식인지 확인하고 분 단위 값으로. 아니면 null. */
export function parseHhmm(v: unknown): number | null {
  if (typeof v !== "string") return null;
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(v.trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

export async function readClockOutLimit(): Promise<ClockOutLimit> {
  try {
    const row = await prisma.appSetting.findUnique({ where: { key: CLOCKOUT_LIMIT_KEY } });
    if (!row?.value) return DEFAULT_CLOCKOUT_LIMIT;
    const v = JSON.parse(row.value) as Partial<ClockOutLimit>;
    const time = parseHhmm(v.time) != null ? (v.time as string) : DEFAULT_CLOCKOUT_LIMIT.time;
    return { enabled: v.enabled !== false, time };
  } catch {
    // ⚠ 읽기 실패를 "제한 없음"으로 흘리면 안 된다. 정책이 깨졌을 때 조용히 풀리는 쪽이
    //   더 나쁘다 — 기본값(자정 마감)으로 되돌아간다.
    return DEFAULT_CLOCKOUT_LIMIT;
  }
}

export async function saveClockOutLimit(v: ClockOutLimit): Promise<void> {
  const value = JSON.stringify({ enabled: !!v.enabled, time: v.time });
  await prisma.appSetting.upsert({
    where: { key: CLOCKOUT_LIMIT_KEY },
    create: { key: CLOCKOUT_LIMIT_KEY, value },
    update: { value },
  });
}
