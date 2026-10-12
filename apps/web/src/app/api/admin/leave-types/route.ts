import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { LEAVE_CATALOG, LEAVE_GROUPS, allLeaveTypes } from "@/lib/leave-catalog";
import { CUSTOM_PREFIX, ensureLeaveCatalog, invalidateLeaveCatalog, saveHiddenLeaveTypes } from "@/lib/leave-catalog-db";

export const dynamic = "force-dynamic";

// 휴가 유형 관리(2026-10-12 개선 제안 #216-1, 디렉터 채택) — 본부만.
//  GET  : 기본 유형(숨김 여부 포함) + 본부가 만든 유형 + 유형별 사용 건수
//  POST : 유형 만들기 { label, group, unit, paidHours, deducts, attachRequired?, notice? }
//  PATCH: { id, ...바꿀 칸 } (본부 유형) / { hidden: string[] } (기본 유형 숨김 목록)
//  DELETE ?id= : 신청 기록이 없는 본부 유형만 지운다(있으면 selectable=false 로 숨기라고 안내)
const UNITS = ["FULL", "HALF", "QUARTER"] as const;
const bad = (msg: string) => NextResponse.json({ error: msg }, { status: 400 });

async function admin() {
  const session = await getSession();
  if (!session) return { res: NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 }) };
  if (session.role !== "ADMIN") return { res: NextResponse.json({ error: "본부만 할 수 있습니다." }, { status: 403 }) };
  return { session };
}

function cleanDef(body: Record<string, unknown>, partial: boolean) {
  const out: Record<string, unknown> = {};
  const errs: string[] = [];
  if (!partial || body.label !== undefined) {
    const label = typeof body.label === "string" ? body.label.trim() : "";
    if (!label || label.length > 30) errs.push("이름은 1~30자");
    else out.label = label;
  }
  if (!partial || body.group !== undefined) {
    if (typeof body.group !== "string" || !(LEAVE_GROUPS as string[]).includes(body.group)) errs.push(`그룹은 ${LEAVE_GROUPS.join("·")} 중 하나`);
    else out.group = body.group;
  }
  if (!partial || body.unit !== undefined) {
    if (typeof body.unit !== "string" || !(UNITS as readonly string[]).includes(body.unit)) errs.push("단위는 FULL·HALF·QUARTER 중 하나");
    else out.unit = body.unit;
  }
  if (!partial || body.paidHours !== undefined) {
    const h = Number(body.paidHours);
    if (!Number.isInteger(h) || h < 0 || h > 24) errs.push("유급 시간은 0~24 정수");
    else out.paidHours = h;
  }
  if (!partial || body.deducts !== undefined) {
    if (typeof body.deducts !== "boolean") errs.push("연차 차감은 예/아니오");
    else out.deducts = body.deducts;
  }
  for (const k of ["attachRequired", "notice"] as const) {
    if (body[k] !== undefined) {
      if (body[k] === null || body[k] === "") out[k] = null;
      else if (typeof body[k] !== "string" || (body[k] as string).length > 200) errs.push(`${k === "attachRequired" ? "필수 첨부" : "안내"}는 200자까지`);
      else out[k] = (body[k] as string).trim();
    }
  }
  if (body.selectable !== undefined) { if (typeof body.selectable !== "boolean") errs.push("신청 목록 표시는 예/아니오"); else out.selectable = body.selectable; }
  if (body.sortOrder !== undefined) { const n = Number(body.sortOrder); if (!Number.isInteger(n)) errs.push("순서는 정수"); else out.sortOrder = n; }
  return { out, err: errs.length ? errs.join(", ") : null };
}

export async function GET() {
  const a = await admin(); if (a.res) return a.res;
  await ensureLeaveCatalog(true);
  const [defs, counts] = await Promise.all([
    prisma.leaveTypeDef.findMany({ orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] }),
    prisma.leaveRequest.groupBy({ by: ["type"], _count: { _all: true } }),
  ]);
  const used = new Map(counts.map((c) => [c.type, c._count._all]));
  const all = allLeaveTypes();
  return NextResponse.json({
    groups: LEAVE_GROUPS,
    builtins: LEAVE_CATALOG.map((t) => ({ code: t.code, label: t.label, group: t.group, unit: t.unit, paidHours: t.paidHours, deducts: t.deducts, attachRequired: t.attachRequired ?? null, notice: t.notice ?? null,
      selectableDefault: t.selectable, hidden: all.find((x) => x.code === t.code)?.selectable === false && t.selectable, used: used.get(t.code) ?? 0 })),
    customs: defs.map((d) => ({ ...d, used: used.get(d.code) ?? 0 })),
  });
}

export async function POST(request: NextRequest) {
  const a = await admin(); if (a.res) return a.res;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const { out, err } = cleanDef(body, false);
  if (err) return bad(err);
  // 이름 중복(기본·본부 유형 모두) 금지 — 같은 이름이 둘이면 기록·리포트에서 구분이 안 된다
  await ensureLeaveCatalog(true);
  if (allLeaveTypes().some((t) => t.label === out.label)) return bad(`「${out.label}」 이름의 유형이 이미 있습니다.`);
  const code = `${CUSTOM_PREFIX}${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  const row = await prisma.leaveTypeDef.create({ data: { code, label: out.label as string, group: out.group as string, unit: out.unit as string, paidHours: out.paidHours as number, deducts: out.deducts as boolean,
    attachRequired: (out.attachRequired as string | null | undefined) ?? null, notice: (out.notice as string | null | undefined) ?? null, selectable: (out.selectable as boolean | undefined) ?? true, sortOrder: (out.sortOrder as number | undefined) ?? 0, createdBy: a.session!.userId } });
  invalidateLeaveCatalog(); await ensureLeaveCatalog(true);
  await logAudit({ actorId: a.session!.userId, actorName: a.session!.name, action: "LEAVE_TYPE_CREATE", targetType: "LeaveTypeDef", targetId: row.id, targetName: row.label,
    detail: `휴가 유형 추가 「${row.label}」 그룹 ${row.group} · 단위 ${row.unit} · 유급 ${row.paidHours}h · 연차 차감 ${row.deducts ? "예" : "아니오"}` });
  return NextResponse.json({ success: true, type: row });
}

export async function PATCH(request: NextRequest) {
  const a = await admin(); if (a.res) return a.res;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  // 기본 유형 숨김 목록
  if (Array.isArray(body.hidden)) {
    const codes = body.hidden.filter((x): x is string => typeof x === "string");
    const unknown = codes.filter((c) => !LEAVE_CATALOG.some((t) => t.code === c));
    if (unknown.length) return bad(`모르는 유형: ${unknown.join(", ")}`);
    if (codes.includes("ANNUAL")) return bad("연차는 숨길 수 없습니다.");
    await saveHiddenLeaveTypes(codes); await ensureLeaveCatalog(true);
    await logAudit({ actorId: a.session!.userId, actorName: a.session!.name, action: "LEAVE_TYPE_HIDE", targetType: "LeaveTypeDef", targetId: "builtins", targetName: "기본 유형 숨김",
      detail: codes.length ? `신청 목록에서 숨김: ${codes.map((c) => LEAVE_CATALOG.find((t) => t.code === c)?.label ?? c).join(", ")}` : "숨긴 기본 유형 없음" });
    return NextResponse.json({ success: true, hidden: codes });
  }
  const id = typeof body.id === "string" ? body.id : "";
  if (!id) return bad("id 가 필요합니다.");
  const existing = await prisma.leaveTypeDef.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "유형을 찾을 수 없습니다." }, { status: 404 });
  const { out, err } = cleanDef(body, true);
  if (err) return bad(err);
  if (!Object.keys(out).length) return bad("바꿀 값이 없습니다.");
  await ensureLeaveCatalog(true);
  if (typeof out.label === "string" && out.label !== existing.label && allLeaveTypes().some((t) => t.label === out.label)) return bad(`「${out.label}」 이름의 유형이 이미 있습니다.`);
  const row = await prisma.leaveTypeDef.update({ where: { id }, data: out });
  invalidateLeaveCatalog(); await ensureLeaveCatalog(true);
  const changes = Object.entries(out).map(([k, v]) => `${k} ${String((existing as Record<string, unknown>)[k] ?? "")}→${String(v ?? "")}`).join(" · ");
  await logAudit({ actorId: a.session!.userId, actorName: a.session!.name, action: "LEAVE_TYPE_UPDATE", targetType: "LeaveTypeDef", targetId: id, targetName: existing.label, detail: changes });
  return NextResponse.json({ success: true, type: row });
}

export async function DELETE(request: NextRequest) {
  const a = await admin(); if (a.res) return a.res;
  const id = new URL(request.url).searchParams.get("id") || "";
  if (!id) return bad("id 가 필요합니다.");
  const existing = await prisma.leaveTypeDef.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "유형을 찾을 수 없습니다." }, { status: 404 });
  const used = await prisma.leaveRequest.count({ where: { type: existing.code } });
  if (used > 0) return NextResponse.json({ error: `이 유형으로 신청한 기록이 ${used}건 있어 지울 수 없습니다. 「신청 목록에서 숨김」으로 바꿔 주세요.` }, { status: 409 });
  await prisma.leaveTypeDef.delete({ where: { id } });
  invalidateLeaveCatalog(); await ensureLeaveCatalog(true);
  await logAudit({ actorId: a.session!.userId, actorName: a.session!.name, action: "LEAVE_TYPE_DELETE", targetType: "LeaveTypeDef", targetId: id, targetName: existing.label, detail: `휴가 유형 삭제 「${existing.label}」(사용 기록 없음)` });
  return NextResponse.json({ success: true });
}
