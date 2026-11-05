import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { canManageMarketing } from "@/lib/marketing-viewer";

export const dynamic = "force-dynamic";

// 마케팅 자료 「블로그 발행 완료」 표시 · 되돌리기(2026-11-05 디렉터) — 큐브마케팅 연동 키(api/v1/.../published) 말고
// 담당자가 이 사진으로 따로 블로그를 쓴 경우. 관리자 · 지정 계정(lib/marketing-viewer)만.
//  POST   { url?: "https://…", notify?: boolean } — 주소는 비워도 된다. notify 면 올린 직원에게 봇 DM(연동 키 경로와 같은 문구)
//  DELETE — 발행 대기로 되돌린다(잘못 누른 경우)
async function guard(id: string) {
  const session = await getSession();
  if (!session) return { res: NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 }) };
  if (!(await canManageMarketing(session))) return { res: NextResponse.json({ error: "발행 처리 권한이 없습니다." }, { status: 403 }) };
  const s = await prisma.submission.findFirst({ where: { id, deletedAt: null, category: { group: "MARKETING" } }, select: { id: true, title: true, userId: true, publishedAt: true, publishedUrl: true, publishedBy: true } });
  if (!s) return { res: NextResponse.json({ error: "마케팅 자료를 찾을 수 없습니다." }, { status: 404 }) };
  return { session, s };
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await guard(id);
  if ("res" in g) return g.res;
  const body = await request.json().catch(() => ({}));
  const url = typeof body.url === "string" ? body.url.trim() : "";
  if (url.length > 500) return NextResponse.json({ error: "블로그 주소가 너무 깁니다(500자까지)." }, { status: 400 });
  if (url && !/^https?:\/\/\S+$/i.test(url)) return NextResponse.json({ error: "블로그 주소는 http:// 또는 https:// 로 시작해야 합니다." }, { status: 400 });
  // 이미 발행된 자료에 주소 없이 다시 보내면 있던 주소(큐브마케팅이 남긴 것 포함)를 지우지 않는다(11/5 검증)
  const keep = !!g.s.publishedAt && !url;
  const row = await prisma.submission.update({
    where: { id },
    data: keep ? {} : { publishedAt: g.s.publishedAt ?? new Date(), publishedUrl: url || null, publishedBy: `${g.session.name}(직접)` },
  });
  await logAudit({ actorId: g.session.userId, actorName: g.session.name, action: "MARKETING_PUBLISHED", targetType: "SUBMISSION", targetId: id, targetName: g.s.title, detail: `직접 표시${url ? ` · ${url}` : " · 주소 없음"}` });
  // 알림은 이 자료에 처음 발행 기록이 남을 때만 — 되돌렸다가 다시 표시해도 두 번 가지 않게(11/5 검증)
  const notifiedBefore = await prisma.auditLog.count({ where: { targetType: "SUBMISSION", targetId: id, action: "MARKETING_PUBLISHED" } });
  if (body.notify === true && !g.s.publishedAt && notifiedBefore <= 1) {
    const { botSendDM } = await import("@/lib/bot");
    void botSendDM(g.s.userId, `📣 올려주신 마케팅 자료 「${g.s.title}」이(가) 블로그에 발행되었습니다.${url ? `\n${url}` : ""}`);
  }
  return NextResponse.json({ id: row.id, publishedAt: row.publishedAt, publishedUrl: row.publishedUrl });
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await guard(id);
  if ("res" in g) return g.res;
  await prisma.submission.update({ where: { id }, data: { publishedAt: null, publishedUrl: null, publishedBy: null } });
  await logAudit({ actorId: g.session.userId, actorName: g.session.name, action: "MARKETING_UNPUBLISHED", targetType: "SUBMISSION", targetId: id, targetName: g.s.title, detail: `발행 대기로 되돌림 · 있던 주소 ${g.s.publishedUrl || "없음"} · 처리 ${g.s.publishedBy || "-"}` });
  return NextResponse.json({ ok: true });
}
