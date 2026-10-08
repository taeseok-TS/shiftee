import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { previewLeaveImport, applyLeaveImport, rollbackLeaveImport, listLeaveImportBatches } from "@/lib/leave-import";

export const dynamic = "force-dynamic";

// 시프티 휴가 사용 내역 가져오기(2026-10-08 QA76 #2) — 본부만.
//  GET: 가져온 배치 목록 / POST { rows, apply, deduct }: apply=false 미리보기, true 적용(deduct=false 면 차감 없이 기록만) / DELETE ?batch=: 되돌리기
const admin = async () => { const s = await getSession(); if (!s) return { err: NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 }) }; if (s.role !== "ADMIN") return { err: NextResponse.json({ error: "본부만 할 수 있습니다." }, { status: 403 }) }; return { s }; };

export async function GET() {
  const { s, err } = await admin(); if (!s) return err;
  return NextResponse.json({ batches: await listLeaveImportBatches() });
}

export async function POST(request: NextRequest) {
  const { s, err } = await admin(); if (!s) return err;
  const body: unknown = await request.json().catch(() => null);
  const b = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const rows = Array.isArray(b.rows) ? (b.rows as unknown[]) : [];
  if (!rows.length) return NextResponse.json({ error: "가져올 행이 없습니다." }, { status: 400 });
  if (rows.length > 2000) return NextResponse.json({ error: "한 번에 2,000행까지 가져올 수 있습니다." }, { status: 400 });
  try {
    if (b.apply === true) {
      const r = await applyLeaveImport(rows, { deduct: b.deduct !== false }, { userId: s.userId, name: s.name });
      return NextResponse.json({ success: true, ...r });
    }
    return NextResponse.json({ preview: true, results: await previewLeaveImport(rows) });
  } catch (e) {
    console.error("[leave-import] 오류:", e);
    return NextResponse.json({ error: "처리하지 못했습니다. 파일 내용을 확인해 주세요." }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const { s, err } = await admin(); if (!s) return err;
  const batch = new URL(request.url).searchParams.get("batch") || "";
  if (!/^imp_\d{8}_[a-z0-9]{6}$/.test(batch)) return NextResponse.json({ error: "배치를 골라 주세요." }, { status: 400 });
  const r = await rollbackLeaveImport(batch, { userId: s.userId, name: s.name });
  return NextResponse.json({ success: true, ...r });
}
