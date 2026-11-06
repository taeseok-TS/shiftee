import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { canManageMarketing } from "@/lib/marketing-viewer";
import { addPublish, lockSubmission, publishHistoryOf, PUBLISH_NOTE_MAX } from "@/lib/marketing-publish";
import type { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

// 마케팅 자료 「블로그 발행 완료」 표시 · 되돌리기(2026-11-05 디렉터) — 큐브마케팅 연동 키(api/v1/.../published) 말고
// 담당자가 이 사진으로 따로 블로그를 쓴 경우. 관리자 · 지정 계정(lib/marketing-viewer)만.
//  POST   { url?: "https://…", note?: "…", notify?: boolean } — 주소 · 덧붙일 말은 비워도 된다. notify 면 올린 직원에게 봇 DM(연동 키 경로와 같은 문구, 덧붙일 말은 그 아래 — 11/6 디렉터)
//         이미 발행된 자료에 다른 글 주소를 넣으면 발행 기록에 한 줄 더(2회 · 3회, lib/marketing-publish). 발행된 자료에 주소 없이는 받지 않는다
//  DELETE ?count=N — 마지막 발행 한 줄을 지운다(잘못 누른 경우). 화면이 본 줄 수(N)와 다르면 그 사이 다른 발행이 더해진 것이라 지우지 않는다(11/6 검증 5)
const SEL = { id: true, title: true, userId: true, publishedAt: true, publishedUrl: true, publishedBy: true, publishHistory: true } as const;
const WHERE = (id: string) => ({ id, deletedAt: null, category: { group: "MARKETING" } });

async function auth() {
  const session = await getSession();
  if (!session) return { res: NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 }) };
  if (!(await canManageMarketing(session))) return { res: NextResponse.json({ error: "발행 처리 권한이 없습니다." }, { status: 403 }) };
  return { session };
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const a = await auth();
  if ("res" in a) return a.res;
  const body = await request.json().catch(() => ({}));
  const url = typeof body.url === "string" ? body.url.trim() : "";
  const note = typeof body.note === "string" ? body.note.trim() : "";
  if (note.length > PUBLISH_NOTE_MAX) return NextResponse.json({ error: `덧붙일 말은 ${PUBLISH_NOTE_MAX}자까지 쓸 수 있습니다.` }, { status: 400 });
  if (url.length > 500) return NextResponse.json({ error: "블로그 주소가 너무 깁니다(500자까지)." }, { status: 400 });
  if (url && !/^https?:\/\/\S+$/i.test(url)) return NextResponse.json({ error: "블로그 주소는 http:// 또는 https:// 로 시작해야 합니다." }, { status: 400 });
  const by = `${a.session.name}(직접)`;

  // 읽고-고치고-쓰기는 행 잠금 안에서 — 두 사람(또는 큐브마케팅 연동)이 겹쳐도 한 줄이 사라지거나 알림이 두 번 가지 않게(11/6 검증 4)
  const r = await prisma.$transaction(async (tx) => {
    await lockSubmission(tx, id);
    const s = await tx.submission.findFirst({ where: WHERE(id), select: SEL });
    if (!s) return { error: NextResponse.json({ error: "마케팅 자료를 찾을 수 없습니다." }, { status: 404 }) };
    // 이미 발행된 자료에 주소 없이 다시 보내면 있던 기록(큐브마케팅이 남긴 것 포함)을 건드리지 않는다(11/5 검증)
    if (s.publishedAt && !url) return { error: NextResponse.json({ error: "이미 발행된 자료입니다. 다른 글로 또 발행했으면 그 글 주소를 넣어 주세요." }, { status: 400 }) };
    const { history, isNew } = addPublish(s, { url: url || null, note: note || null, by });
    // 되돌렸다가 같은 글로 다시 표시하면 알림이 또 가지 않게 — 그 주소(주소 없이는 「주소 없음」)로 앞서 남은 발행 기록이 있는지.
    // 감사 기록 문구는 「… · 주소 · …」 모양이라 앞뒤 구분자까지 맞춰 본다(부분 문자열로 다른 글 주소에 걸리지 않게, 11/6 검증 1)
    const key = url || "주소 없음";
    const sentBefore = isNew ? await tx.auditLog.count({
      where: { targetType: "SUBMISSION", targetId: id, action: "MARKETING_PUBLISHED", OR: [{ detail: { contains: ` · ${key} · ` } }, { detail: { endsWith: ` · ${key}` } }] },
    }) : 0;
    await tx.submission.update({
      where: { id },
      data: isNew
        ? { publishHistory: history as unknown as Prisma.InputJsonValue, publishedAt: new Date(), publishedUrl: url || null, publishedBy: by }
        : { publishHistory: history as unknown as Prisma.InputJsonValue, publishedUrl: history[history.length - 1].url },
    });
    return { s, history, isNew, sentBefore };
  });
  if ("error" in r) return r.error;
  const { s, history, isNew, sentBefore } = r;
  await logAudit({ actorId: a.session.userId, actorName: a.session.name, action: "MARKETING_PUBLISHED", targetType: "SUBMISSION", targetId: id, targetName: s.title, detail: `직접 표시 · ${url || "주소 없음"} · ${note ? `${note} · ` : ""}${isNew ? `${history.length}회` : "같은 글(주소 · 메모만)"}` });
  if (body.notify === true && isNew && sentBefore === 0) {
    const { botSendDM } = await import("@/lib/bot");
    void botSendDM(s.userId, `📣 올려주신 마케팅 자료 「${s.title}」이(가) 블로그에 ${history.length === 1 ? "발행되었습니다" : `또 발행되었습니다(${history.length}번째 글)`}.${url ? `\n${url}` : ""}${note ? `\n${note}` : ""}`);
  }
  return NextResponse.json({ id, publishCount: history.length, isNew });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const a = await auth();
  if ("res" in a) return a.res;
  const expect = Number(new URL(request.url).searchParams.get("count"));
  const r = await prisma.$transaction(async (tx) => {
    await lockSubmission(tx, id);
    const s = await tx.submission.findFirst({ where: WHERE(id), select: SEL });
    if (!s) return { error: NextResponse.json({ error: "마케팅 자료를 찾을 수 없습니다." }, { status: 404 }) };
    const history = publishHistoryOf(s);
    if (!history.length) return { error: NextResponse.json({ error: "이미 발행 대기 상태입니다." }, { status: 409 }) };
    if (Number.isInteger(expect) && expect > 0 && expect !== history.length)
      return { error: NextResponse.json({ error: "그 사이 발행 기록이 바뀌었습니다. 새로고침 후 다시 해 주세요." }, { status: 409 }) };
    const removed = history.pop()!;
    const last = history[history.length - 1];
    await tx.submission.update({
      where: { id },
      data: last
        ? { publishHistory: history as unknown as Prisma.InputJsonValue, publishedAt: new Date(last.at), publishedUrl: last.url, publishedBy: last.by }
        : { publishHistory: [] as unknown as Prisma.InputJsonValue, publishedAt: null, publishedUrl: null, publishedBy: null },
    });
    return { s, removed, left: history.length };
  });
  if ("error" in r) return r.error;
  await logAudit({ actorId: a.session.userId, actorName: a.session.name, action: "MARKETING_UNPUBLISHED", targetType: "SUBMISSION", targetId: id, targetName: r.s.title, detail: `마지막 발행 지움 · 주소 ${r.removed.url || "없음"} · 처리 ${r.removed.by || "-"} · 남은 ${r.left}회` });
  return NextResponse.json({ ok: true, publishCount: r.left });
}
