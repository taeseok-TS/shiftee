import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { previewScheduleImport, applyScheduleImport, rollbackScheduleImport, listScheduleImportBatches } from "@/lib/schedule-import";

export const dynamic = "force-dynamic";

// 근무일정 엑셀 업로드(2026-10-13 QA76 #75) — 본부·원장(담당 지점만).
//  GET: 가져온 묶음 목록 / POST { rows, apply, overwrite }: apply=false 미리보기, true 적용 / DELETE ?batch=: 되돌리기
const who = async () => {
  const s = await getSession();
  if (!s) return { err: NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 }) };
  if (s.role !== "ADMIN" && s.role !== "MANAGER") return { err: NextResponse.json({ error: "권한이 없습니다." }, { status: 403 }) };
  return { s };
};

export async function GET() {
  const { s, err } = await who(); if (!s) return err;
  return NextResponse.json({ batches: await listScheduleImportBatches({ userId: s.userId, role: s.role, name: s.name }) });
}

export async function POST(request: NextRequest) {
  const { s, err } = await who(); if (!s) return err;
  const body: unknown = await request.json().catch(() => null);
  const b = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const rows = Array.isArray(b.rows) ? (b.rows as unknown[]) : [];
  if (!rows.length) return NextResponse.json({ error: "가져올 행이 없습니다." }, { status: 400 });
  if (rows.length > 5000) return NextResponse.json({ error: "한 번에 5,000칸까지 올릴 수 있습니다. 기간을 나눠 주세요." }, { status: 400 });
  const overwrite = b.overwrite === true;
  const actor = { userId: s.userId, role: s.role, name: s.name };
  try {
    if (b.apply === true) return NextResponse.json({ success: true, ...(await applyScheduleImport(rows, actor, overwrite)) });
    return NextResponse.json({ preview: true, results: await previewScheduleImport(rows, actor, overwrite) });
  } catch (e) {
    console.error("[schedule-import] 오류:", e);
    return NextResponse.json({ error: "처리하지 못했습니다. 파일 내용을 확인해 주세요." }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const { s, err } = await who(); if (!s) return err;
  const batch = new URL(request.url).searchParams.get("batch") || "";
  if (!/^simp_\d{8}_[a-z0-9]{6}$/.test(batch)) return NextResponse.json({ error: "묶음을 골라 주세요." }, { status: 400 });
  try {
    return NextResponse.json({ success: true, ...(await rollbackScheduleImport(batch, { userId: s.userId, role: s.role, name: s.name })) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "되돌리지 못했습니다." }, { status: 403 });
  }
}
