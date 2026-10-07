import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { LEAVE_CATALOG } from "@/lib/leave-catalog";

export const dynamic = "force-dynamic";

// 휴가 유형 기준표(2026-10-07 QA #30) — 앱 신청 화면이 받아 쓴다(웹은 lib/leave-catalog 를 바로 쓴다).
// labels 는 옛 유형까지 전부(기록 표시용), types 는 새 신청 목록만.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  return NextResponse.json({
    types: LEAVE_CATALOG.filter((t) => t.selectable).map((t) => ({
      code: t.code, label: t.label, group: t.group, unit: t.unit, paidHours: t.paidHours,
      deducts: t.deducts, attachRequired: t.attachRequired ?? null, notice: t.notice ?? null,
    })),
    labels: Object.fromEntries(LEAVE_CATALOG.map((t) => [t.code, t.label])),
  });
}
