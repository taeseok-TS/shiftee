import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { allLeaveTypes } from "@/lib/leave-catalog";
import { ensureLeaveCatalog } from "@/lib/leave-catalog-db";

export const dynamic = "force-dynamic";

// 휴가 유형 기준표(2026-10-07 QA #30) — 앱 신청 화면이 받아 쓴다(웹은 lib/leave-catalog 를 바로 쓴다).
// labels 는 옛 유형까지 전부(기록 표시용), types 는 새 신청 목록만.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  await ensureLeaveCatalog();   // 본부가 만든 유형·숨김 반영(#216-1)
  const all = allLeaveTypes();
  const pack = (t: (typeof all)[number]) => ({
    code: t.code, label: t.label, group: t.group, unit: t.unit, paidHours: t.paidHours,
    deducts: t.deducts, attachRequired: t.attachRequired ?? null, notice: t.notice ?? null, selectable: t.selectable, adminOnly: !!t.adminOnly, custom: !!t.custom,
  });
  return NextResponse.json({
    types: all.filter((t) => t.selectable).map(pack),
    all: all.map(pack),   // 옛·숨긴 유형까지(기록 표시·일수 계산용)
    labels: Object.fromEntries(all.map((t) => [t.code, t.label])),
  });
}
