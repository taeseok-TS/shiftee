import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { grantSummary, addManualGrant, isGrantGroup } from "@/lib/leave-grant";

export const dynamic = "force-dynamic";

const ymdOk = (v: string | null) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(new Date(`${v}T00:00:00Z`).getTime()) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;

// 휴가 종류별 잔여(2026-10-08 QA76 #50) — 본부만. GET ?asOf=YYYY-MM-DD&includeAdmins=true&includeTest=true
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role !== "ADMIN") return NextResponse.json({ error: "본부만 볼 수 있습니다." }, { status: 403 });
  const sp = new URL(request.url).searchParams;
  const asOfRaw = sp.get("asOf");
  const asOf = ymdOk(asOfRaw) ? new Date(`${asOfRaw}T00:00:00Z`) : new Date(new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10) + "T00:00:00Z");
  const rows = await grantSummary({ asOf, includeAdmins: sp.get("includeAdmins") === "true", includeTest: sp.get("includeTest") === "true" });
  return NextResponse.json({ asOf: asOf.toISOString().slice(0, 10), rows });
}

// 수동 조정 — { userId, group, days(±, 0.25 단위 아님도 허용), note }
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role !== "ADMIN") return NextResponse.json({ error: "본부만 조정할 수 있습니다." }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  const userId = typeof body.userId === "string" ? body.userId : "";
  const days = Number(body.days);
  const note = typeof body.note === "string" ? body.note.trim() : "";
  if (!userId || !isGrantGroup(body.group)) return NextResponse.json({ error: "직원과 휴가 종류를 고르세요." }, { status: 400 });
  if (!Number.isFinite(days) || days === 0 || Math.abs(days) > 30) return NextResponse.json({ error: "일수는 0이 아닌 ±30 이내로 넣어 주세요." }, { status: 400 });
  if (!note) return NextResponse.json({ error: "사유를 적어 주세요." }, { status: 400 });
  try {
    const row = await addManualGrant({ userId, group: body.group, days: Math.round(days * 100) / 100, note }, { userId: session.userId, name: session.name });
    return NextResponse.json({ success: true, id: row.id });
  } catch (e) {
    if (e instanceof Error && e.message === "USER_NOT_FOUND") return NextResponse.json({ error: "직원을 찾을 수 없습니다." }, { status: 404 });
    console.error("[leave-grant] 수동 조정 오류:", e);
    return NextResponse.json({ error: "조정하지 못했습니다." }, { status: 500 });
  }
}
