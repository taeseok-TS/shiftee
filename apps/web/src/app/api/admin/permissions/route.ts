import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { PERMISSION_TOGGLES, FIXED_RULES, readPermissions, savePermissions, type PermissionKey, type PermissionSettings } from "@/lib/permission-settings";

// 역할별 권한 설정(QA76 #39) — 조회·변경은 관리자만. 변경은 바뀐 항목만 감사 기록에 남긴다
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role !== "ADMIN") return NextResponse.json({ error: "관리자만 접근할 수 있습니다." }, { status: 403 });
  return NextResponse.json({ settings: await readPermissions(), toggles: PERMISSION_TOGGLES, fixed: FIXED_RULES });
}

export async function PATCH(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role !== "ADMIN") return NextResponse.json({ error: "관리자만 변경할 수 있습니다." }, { status: 403 });
  const raw = await request.json().catch(() => null);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return NextResponse.json({ error: "요청 본문이 올바르지 않습니다." }, { status: 400 });
  const body = raw as Record<string, unknown>;
  const before = await readPermissions();
  const next: PermissionSettings = { ...before };
  const changes: string[] = [];
  for (const t of PERMISSION_TOGGLES) {
    const v = body[t.key];
    if (v === undefined) continue;
    if (typeof v !== "boolean") return NextResponse.json({ error: `${t.label}: 켬/끔 값이어야 합니다.` }, { status: 400 });
    if (v !== before[t.key]) { next[t.key as PermissionKey] = v; changes.push(`${t.role === "MANAGER" ? "원장" : "직원"} ${t.label} ${before[t.key] ? "켬" : "끔"}→${v ? "켬" : "끔"}`); }
  }
  if (!changes.length) return NextResponse.json({ success: true, settings: before, changed: false });
  await savePermissions(next);
  // 권한은 급여·근태·개인정보 범위를 바꾼다 — 누가 언제 무엇을 바꿨는지 남긴다
  await logAudit({
    actorId: session.userId, actorName: session.name, action: "PERMISSION_SETTINGS_UPDATE",
    targetType: "AppSetting", targetId: "permissions", targetName: "역할별 권한 설정", detail: changes.join(" · "),
  }).catch(() => {});
  return NextResponse.json({ success: true, settings: next, changed: true });
}
