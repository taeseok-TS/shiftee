import { NextRequest, NextResponse } from "next/server";
import { getSession, isSuperAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { PORTAL_SETTING, decideChange, fetchPortalRoster, isAutoApply, portalConfig, runPortalSync, validRosterUrl } from "@/lib/portal-roster";

export const dynamic = "force-dynamic";

// 포털(직영인사) 인원명부 연동 현황 — 본부 전용. 순수 GET(키 값은 절대 내보내지 않는다).
//  ?brief=1 → { configured, autoApply } 만 (직원 수정 창 안내용)
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role !== "ADMIN") return NextResponse.json({ error: "관리자만 볼 수 있습니다." }, { status: 403 });
  const [cfg, autoApply] = await Promise.all([portalConfig(), isAutoApply()]);
  if (new URL(request.url).searchParams.get("brief") === "1") return NextResponse.json({ configured: !!cfg, autoApply });

  const [settings, runs, pending, recent, superAdmin] = await Promise.all([
    prisma.appSetting.findMany({ where: { key: { in: [PORTAL_SETTING.url, PORTAL_SETTING.apikey, PORTAL_SETTING.token] } } }),
    prisma.portalSyncRun.findMany({ orderBy: { startedAt: "desc" }, take: 10 }),
    prisma.portalSyncChange.findMany({ where: { status: { in: ["PENDING", "APPLYING"] } }, orderBy: [{ kind: "asc" }, { name: "asc" }], take: 500 }),
    prisma.portalSyncChange.findMany({ where: { status: { in: ["APPLIED", "DONE", "DISMISSED"] } }, orderBy: { updatedAt: "desc" }, take: 60 }),
    isSuperAdmin(session.userId),
  ]);
  const val = (k: string) => settings.find((s) => s.key === k)?.value ?? "";
  // ⚠ 시트 주소는 그 자체가 열쇠다 — 링크를 아는 사람은 인사 원장 전체(생년월일·연락처·주소)를 내려받는다.
  //   예전 포털 주소는 키 없이는 쓸모가 없어 그대로 내려줊c지만, 지금은 주소 하나가 접근권이다.
  //   어느 관리자에게도 원문을 주지 않고, 어디에 붙어 있는지만 보여준다(2026-09-16 검증관 2).
  const urlLabel = (() => {
    const u = val(PORTAL_SETTING.url);
    if (!u) return "";
    try {
      const h = new URL(u);
      if (h.hostname === "docs.google.com") return "인사 원장(구글 시트)";
      return h.hostname;
    } catch { return "등록됨"; }
  })();
  return NextResponse.json({
    configured: !!cfg,
    canEditConnection: superAdmin,
    connection: { urlLabel, urlSet: !!val(PORTAL_SETTING.url), apikeySet: !!val(PORTAL_SETTING.apikey), tokenSet: !!val(PORTAL_SETTING.token) },
    autoApply,
    // 요약(skipped·missingInPortal 목록)은 가장 최근 실행 것만 싣는다
    runs: runs.map((r, i) => ({ ...r, summary: i === 0 ? r.summary : null })),
    pending,
    recent,
  });
}

// 동작 — { action: "run" } 지금 가져오기 / "setAuto" {value} / "applyAllUpdates" / "saveConnection" {url, apikey, token} / "testConnection"
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role !== "ADMIN") return NextResponse.json({ error: "관리자만 할 수 있습니다." }, { status: 403 });
  const actor = { id: session.userId, name: session.name };
  const body = await request.json().catch(() => ({}));
  const action = typeof body.action === "string" ? body.action : "";

  if (action === "run") {
    if (!(await portalConfig())) return NextResponse.json({ error: "연결 정보를 먼저 저장해주세요." }, { status: 400 });
    const r = await runPortalSync("MANUAL", actor);
    if (!r.ok) return NextResponse.json({ error: r.error || "가져오지 못했습니다.", result: r }, { status: 502 });
    return NextResponse.json({ result: r });
  }

  if (action === "setAuto") {
    if (typeof body.value !== "boolean") return NextResponse.json({ error: "값이 올바르지 않습니다." }, { status: 400 });
    await prisma.appSetting.upsert({ where: { key: PORTAL_SETTING.auto }, create: { key: PORTAL_SETTING.auto, value: body.value ? "1" : "0" }, update: { value: body.value ? "1" : "0" } });
    await logAudit({ actorId: actor.id, actorName: actor.name, action: "PORTAL_SYNC_SETTING", detail: `인사명부 일반 칸 자동 반영 ${body.value ? "켬" : "끔"}` });
    return NextResponse.json({ autoApply: body.value });
  }

  if (action === "applyAllUpdates") {
    // 개별 확인이 필요한 건(개명·원장 계정)은 빼고 일반 칸 변경만 한 번에
    const rows = await prisma.portalSyncChange.findMany({ where: { status: "PENDING", kind: "UPDATE" }, select: { id: true, diff: true } });
    let done = 0; const failed: string[] = [];
    for (const r of rows) {
      const d = r.diff as { nameMismatch?: boolean; managerScope?: boolean; weakIdentity?: boolean; unverified?: boolean } | null;
      if (d?.nameMismatch || d?.managerScope || d?.weakIdentity || d?.unverified) continue; // 개명·원장 계정·같은 사람 확인 안 된 경우는 한 건씩
      const res = await decideChange(r.id, "apply", actor);
      if (res.ok === false) failed.push(res.error); else done++; // strictNullChecks 없이는 res.ok 로 좁혀지지 않는다
    }
    return NextResponse.json({ done, failed: failed.length, errors: failed.slice(0, 5) });
  }

  if (action === "saveConnection" || action === "testConnection") {
    if (!(await isSuperAdmin(session.userId))) return NextResponse.json({ error: "연결 정보는 메인 관리자만 다룰 수 있습니다." }, { status: 403 });
  }

  if (action === "saveConnection") {
    const url = typeof body.url === "string" ? body.url.trim() : "";
    const apikey = typeof body.apikey === "string" ? body.apikey.trim() : "";
    const token = typeof body.token === "string" ? body.token.trim() : "";
    if (!validRosterUrl(url)) return NextResponse.json({ error: "주소는 인사 원장(https://docs.google.com/spreadsheets/d/…) 또는 포털 읽기 전용 뷰(https://…supabase.co/rest/v1/…) 주소여야 합니다." }, { status: 400 });
    const put = (key: string, value: string) => prisma.appSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
    await put(PORTAL_SETTING.url, url);
    // 비워 두면 기존 키를 유지한다(화면에 키를 다시 보여주지 않으므로)
    if (apikey) await put(PORTAL_SETTING.apikey, apikey);
    if (token) await put(PORTAL_SETTING.token, token);
    await logAudit({ actorId: actor.id, actorName: actor.name, action: "PORTAL_SYNC_SETTING", detail: `인사명부 연결 정보 저장 (${new URL(url).host}${apikey ? " · API 키 교체" : ""}${token ? " · 토큰 교체" : ""})` });
    return NextResponse.json({ ok: true });
  }

  if (action === "testConnection") {
    const cfg = await portalConfig();
    if (!cfg) return NextResponse.json({ error: "주소와 API 키를 먼저 저장해주세요." }, { status: 400 });
    try {
      const rows = await fetchPortalRoster(cfg);
      const byStatus: Record<string, number> = {};
      for (const r of rows) byStatus[r.status || "(빈 값)"] = (byStatus[r.status || "(빈 값)"] ?? 0) + 1;
      return NextResponse.json({ ok: true, count: rows.length, byStatus, withEmpNo: rows.filter((r) => r.empNo).length });
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message || "연결하지 못했습니다." }, { status: 502 });
    }
  }

  return NextResponse.json({ error: "알 수 없는 동작입니다." }, { status: 400 });
}
