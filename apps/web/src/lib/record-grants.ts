import { prisma } from "@/lib/db";

// 출퇴근 기록 요청(RECORD) 승인 = 「열람 허용 창」(2026-10-27 이예지 ⑦)
//  본부가 승인하면 요청한 직원 본인과 그 지점 원장에게 **요청 기간의 날짜만** 찍은 시각 · 일한 시간이 보인다.
//  새 표 없이 승인된 RECORD 요청(memo "YYYY-MM-DD~YYYY-MM-DD")을 그대로 허용 창으로 쓴다 — 반려 · 취소는 아무것도 열지 않는다.
//  수정은 여전히 수정 요청 → 본부. 요청 기간 밖 날짜 · 다른 직원은 종전처럼 상태만.

const RANGE = /^(\d{4}-\d{2}-\d{2})~(\d{4}-\d{2}-\d{2})$/;

/** userIds 의 승인된 기록 요청 중 [fromYmd, toYmd] 와 겹치는 날짜 → Map<userId, Set<"YYYY-MM-DD">> */
export async function recordGrantDays(userIds: string[], fromYmd: string, toYmd: string): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  if (!userIds.length) return out;
  let rows: { userId: string; memo: string | null }[] = [];
  try {
    rows = await prisma.attendanceRequest.findMany({
      where: { userId: { in: userIds }, kind: "RECORD", status: "APPROVED" },
      select: { userId: true, memo: true },
    });
  } catch (e) {
    console.error("[record-grants] 조회 실패(시각은 숨긴 채로):", e instanceof Error ? e.message : e);
    return out;
  }
  for (const r of rows) {
    const m = RANGE.exec(r.memo ?? "");
    if (!m) continue;
    const start = m[1] > fromYmd ? m[1] : fromYmd;
    const end = m[2] < toYmd ? m[2] : toYmd;
    if (start > end) continue;
    const set = out.get(r.userId) ?? new Set<string>();
    for (let d = new Date(`${start}T00:00:00Z`); ; d.setUTCDate(d.getUTCDate() + 1)) {
      const y = d.toISOString().slice(0, 10);
      if (y > end) break;
      set.add(y);
      if (set.size > 400) break;   // 1년 넘는 요청은 서버가 막지만 혹시 모를 폭주 방지
    }
    out.set(r.userId, set);
  }
  return out;
}

export const isGranted = (grants: Map<string, Set<string>>, userId: string, ymd: string) => grants.get(userId)?.has(ymd) === true;
