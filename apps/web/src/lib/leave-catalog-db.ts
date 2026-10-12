import { prisma } from "@/lib/db";
import { registerExtraLeaveTypes, setHiddenLeaveTypes, LEAVE_CATALOG, LEAVE_GROUPS, type LeaveTypeInfo, type LeaveGroup, type LeaveUnit } from "@/lib/leave-catalog";

// 휴가 유형 직접 추가(2026-10-12 개선 제안 #216-1, 디렉터 채택) — 서버 쪽 적재기.
//  · 본부가 만든 유형(LeaveTypeDef 표)과 숨긴 기본 유형(AppSetting leaveTypes.hidden)을 읽어 lib/leave-catalog 의 조회 함수에 얹는다.
//    그러면 leaveInfo/leaveLabel/allLeaveTypes 를 쓰는 서버 코드(신청 검증·연차 차감·리포트·봇·이관)가 그대로 새 유형을 안다.
//  · 서버가 뜰 때(instrumentation) 한 번 읽고 60초마다 다시 읽는다. 본부가 유형을 바꾸면 invalidate 로 바로 다시 읽는다.
//  · 사용자 지정 유형의 코드는 "CUSTOM_" 으로 시작한다 — 기본 유형 코드와 절대 겹치지 않는다
export const CUSTOM_PREFIX = "CUSTOM_";
export const HIDDEN_KEY = "leaveTypes.hidden";
const TTL_MS = 60 * 1000;
let loadedAt = 0;
let inflight: Promise<void> | null = null;

export type LeaveTypeDefRow = {
  id: string; code: string; label: string; group: string; unit: string; paidHours: number; deducts: boolean;
  attachRequired: string | null; notice: string | null; selectable: boolean; sortOrder: number;
};

function toInfo(r: LeaveTypeDefRow): LeaveTypeInfo | null {
  if (!(LEAVE_GROUPS as string[]).includes(r.group)) return null;
  if (!["FULL", "HALF", "QUARTER"].includes(r.unit)) return null;
  return {
    code: r.code, label: r.label, group: r.group as LeaveGroup, unit: r.unit as LeaveUnit, paidHours: r.paidHours, deducts: r.deducts,
    attachRequired: r.attachRequired ?? undefined, notice: r.notice ?? undefined, selectable: r.selectable, custom: true,
  };
}

export async function ensureLeaveCatalog(force = false): Promise<void> {
  const now = Date.now();
  if (!force && loadedAt && now - loadedAt < TTL_MS) return;
  if (inflight) {
    if (!force) return inflight;
    await inflight;   // 바꾼 직후의 강제 재적재는 진행 중인(옛) 적재를 기다린 뒤 **새로** 읽는다(485880f 검증 F3)
  }
  inflight = (async () => {
    try {
      const [rows, hidden] = await Promise.all([
        prisma.leaveTypeDef.findMany({ orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] }),
        prisma.appSetting.findUnique({ where: { key: HIDDEN_KEY } }),
      ]);
      registerExtraLeaveTypes(rows.map(toInfo).filter((x): x is LeaveTypeInfo => !!x));
      let hiddenCodes: string[] = [];
      try { const v = JSON.parse(hidden?.value || "[]"); if (Array.isArray(v)) hiddenCodes = v.filter((x): x is string => typeof x === "string"); } catch { /* 무시 */ }
      setHiddenLeaveTypes(hiddenCodes.filter((c) => LEAVE_CATALOG.some((t) => t.code === c)));
      loadedAt = Date.now();
    } catch (e) {
      console.error("[leave-catalog] 사용자 유형 적재 실패:", e instanceof Error ? e.message : e);
      loadedAt = Date.now() - TTL_MS + 10_000;   // 10초 뒤 다시
    } finally { inflight = null; }
  })();
  return inflight;
}

export function invalidateLeaveCatalog(): void { loadedAt = 0; }

/** 숨긴 기본 유형 코드 목록 저장(본부 화면) */
export async function saveHiddenLeaveTypes(codes: string[]): Promise<void> {
  const valid = [...new Set(codes.filter((c) => LEAVE_CATALOG.some((t) => t.code === c)))];
  await prisma.appSetting.upsert({ where: { key: HIDDEN_KEY }, create: { key: HIDDEN_KEY, value: JSON.stringify(valid) }, update: { value: JSON.stringify(valid) } });
  invalidateLeaveCatalog();
}
