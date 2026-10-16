import type { Prisma } from "@prisma/client";
import { yearBalanceFor } from "@/lib/leave-balance";
import { isLeaveDeductible } from "@/lib/leave-types";
import { leaveYearOfLeave } from "@/lib/leave-calc";
import { groupCodes, groupOfType, type GrantGroup } from "@/lib/leave-grant";

// ─── 잔여 초과 신청 막기 — 판정은 **이 함수 하나**(2026-10-16 #219-7·11) ─────────────────────────
// 쓰는 곳: 신청(api/leave POST — 본인·본부 대리 등록), 신청 창 미리보기(api/leave/days), 최종 승인(api/leave/[id]/approve
// 단계 최종 승인·관리자 직접 처리). 화면과 서버가 같은 판정을 쓰게 미리보기 API 가 이 결과를 그대로 돌려준다.
//  · 연차(isLeaveDeductible 유형): 휴가를 쓰는 해(leaveYearOfLeave(시작일))의 잔여(yearBalanceFor — 화면 「잔여」와 같은 값).
//    그 해 행이 없는 지난 해는 종전처럼 검사하지 않는다(remaining null).
//  · 보상휴가·대체휴일(디렉터 결정 (c) — 10/8 「막지 않음」을 바꿈): 잔여 = 그 그룹 부여 합(LeaveGrant.days 전체, 음수 조정 포함)
//    − 승인된 그 그룹 유형 사용 합. 그룹 유형은 본부가 만든 유형까지(allLeaveTypes) — 호출부가 ensureLeaveCatalog 를 먼저 부른다.
//  · 신청 때는 **결재 대기(PENDING) 신청까지 합산**한다(같은 해·같은 차감 대상). 종전에는 대기분을 안 세어 여러 건을 올리면
//    잔여를 넘길 수 있었다(#219-11). 최종 승인 때는 대기분을 빼고 **지금 잔여만** 본다(다른 대기 건이 승인을 막지 않게).
//  · 반차·반반차도 같은 기준(0.5·0.25일).
// 잔여 숫자를 숨기는 설정(#219-1)이어도 막기는 그대로다 — 문구에서 숫자만 뺀다(limitMessage visible=false).

type Db = Prisma.TransactionClient;
const r2 = (n: number) => Math.round(n * 100) / 100;
const EPS = 1e-9;

export type LeaveLimit =
  | { kind: "none"; blocked: false }
  | { kind: "annual"; year: number; remaining: number | null; pending: number; requested: number; available: number | null; blocked: boolean }
  | { kind: "grant"; group: GrantGroup; remaining: number; pending: number; requested: number; available: number; blocked: boolean };

export async function checkLeaveLimit(
  db: Db,
  opts: { userId: string; type: string; startDate: Date; days: number; includePending: boolean; excludeRequestId?: string },
): Promise<LeaveLimit> {
  const { userId, type, startDate, days, includePending, excludeRequestId } = opts;
  const notMe = excludeRequestId ? { id: { not: excludeRequestId } } : {};

  if (isLeaveDeductible(type)) {
    const year = leaveYearOfLeave(startDate);
    const bal = await yearBalanceFor(db, userId, year);
    let pending = 0;
    if (includePending) {
      const rows = await db.leaveRequest.findMany({
        where: { userId, status: "PENDING", startDate: { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) }, ...notMe },
        select: { type: true, days: true },
      });
      pending = r2(rows.filter((r) => isLeaveDeductible(r.type)).reduce((a, r) => a + r.days, 0));
    }
    if (!bal) return { kind: "annual", year, remaining: null, pending, requested: days, available: null, blocked: false };
    const remaining = r2(bal.remaining);
    const available = r2(remaining - pending);
    return { kind: "annual", year, remaining, pending, requested: days, available, blocked: available + EPS < days };
  }

  const group = groupOfType(type);
  if (!group) return { kind: "none", blocked: false };
  // 보상·대체 막기는 스위치가 켜졌을 때만(디렉터 10/16 「이관 뒤부터」 — lib/permission-settings leave.blockGrantOverdraw, 기본 끔)
  const { isAllowed } = await import("@/lib/permission-settings");
  const enforce = await isAllowed("leave.blockGrantOverdraw");
  // 막기가 꺼져 있으면 판정 자체를 하지 않는다 — 부여 기록이 없는 지금 음수 잔여가 신청 창에 보이던 것(재검증 4)
  if (!enforce) return { kind: "none", blocked: false };
  const codes = groupCodes(group);
  const [granted, used, pend] = await Promise.all([
    db.leaveGrant.aggregate({ where: { userId, group }, _sum: { days: true } }),
    // 승인된 사용 — 자기 자신은 뺀다(관리자 직접 처리는 상태를 먼저 APPROVED 로 바꾼 뒤 검사해 두 번 세었다, 검증 1)
    db.leaveRequest.aggregate({ where: { userId, status: "APPROVED", type: { in: codes }, ...notMe }, _sum: { days: true } }),
    includePending
      ? db.leaveRequest.aggregate({ where: { userId, status: "PENDING", type: { in: codes }, ...notMe }, _sum: { days: true } })
      : Promise.resolve({ _sum: { days: 0 } }),
  ]);
  const remaining = r2((granted._sum.days ?? 0) - (used._sum.days ?? 0));
  const pending = r2(pend._sum.days ?? 0);
  const available = r2(remaining - pending);
  return { kind: "grant", group, remaining, pending, requested: days, available, blocked: available + EPS < days };
}

/**
 * 막힐 때 문구 — visible=false(잔여 숫자 숨김, #219-1)면 숫자를 말하지 않는다.
 * when: "request" = 신청, "approve" = 최종 승인. who = 본부 대리 등록일 때 대상 직원 이름.
 */
export function limitMessage(l: LeaveLimit, opts: { visible: boolean; when: "request" | "approve"; who?: string }): string {
  if (l.kind === "none") return "";
  const subject = l.kind === "annual" ? "연차" : l.group;
  const prefix = opts.who ? `${opts.who}님의 ` : "";
  if (opts.when === "approve") {
    const nums = opts.visible
      ? (l.kind === "annual" ? ` (${l.year}년 잔여 ${l.remaining ?? "-"}일, 이 신청 ${l.requested}일)` : ` (${l.group} 잔여 ${l.remaining}일, 이 신청 ${l.requested}일)`)
      : "";
    return `${prefix}${subject} 잔여가 부족해 승인할 수 없습니다.${nums}`;
  }
  if (!opts.visible) {
    return `${prefix}${subject} 잔여가 부족해 신청할 수 없습니다${l.pending > 0 ? "(결재 대기 중인 신청 포함)" : ""}. 남은 일수는 연차 정리 중이라 본부에 문의해 주세요.`;
  }
  const head = l.kind === "annual" ? `${l.year}년 잔여 ${l.remaining}일` : `${l.group} 잔여 ${l.remaining}일`;
  return `${prefix}${subject} 잔여가 부족합니다. (${head}${l.pending > 0 ? `, 결재 대기 ${l.pending}일` : ""}, 신청 ${l.requested}일)`;
}
