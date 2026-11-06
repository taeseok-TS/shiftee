import { NextRequest, NextResponse } from "next/server";
import { authenticateApiKey, v1Error } from "@/lib/api-key";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { addPublish, lockSubmission, PUBLISH_NOTE_MAX } from "@/lib/marketing-publish";
import type { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

// 큐브마케팅이 블로그에 올린 뒤 결과를 되돌려준다 (회사 연동 키, marketing:publish)
//  JSON { url: "https://blog…", note?: "…"(300자) } — 다른 주소로 다시 보내면 발행 기록에 한 줄 더(2회 · 3회, 2026-11-06), 그때마다 올린 직원에게 봇 DM.
//  같은 주소를 다시 보내면 덧붙일 말만 고치고 DM 은 보내지 않는다. 응답에 publishCount · isNew
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const a = await authenticateApiKey(request, "marketing:publish", "write");
  if (a.ok === false) return a.res;
  if (a.p.key.kind !== "ORG") return v1Error(403, "회사 연동 키로만 쓸 수 있습니다.", "ORG_KEY_ONLY");
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const url = typeof body.url === "string" ? body.url.trim().slice(0, 500) : "";
  if (!/^https?:\/\/\S+$/i.test(url)) return v1Error(400, "url 은 http(s) 주소여야 합니다.", "BAD_URL");
  const note = typeof body.note === "string" ? body.note.trim().slice(0, PUBLISH_NOTE_MAX) : "";
  // 발행 기록에 더한다(lib/marketing-publish, 2026-11-06) — 다른 주소면 새 글(2회 · 3회…), 같은 주소면 덧붙일 말만 고치고 알림은 다시 보내지 않는다.
  // 읽고-고치고-쓰기는 행 잠금 안에서 — 화면 직접 표시와 겹쳐도 한 줄이 사라지거나 알림이 두 번 가지 않게(11/6 검증 4)
  const done = await prisma.$transaction(async (tx) => {
    await lockSubmission(tx, id);
    const s = await tx.submission.findFirst({ where: { id, deletedAt: null, category: { group: "MARKETING" } } });
    if (!s) return null;
    const { history, isNew } = addPublish(s, { url, note: note || null, by: a.p.key.name });
    const row = await tx.submission.update({
      where: { id },
      data: isNew
        ? { publishHistory: history as unknown as Prisma.InputJsonValue, publishedAt: new Date(), publishedUrl: url, publishedBy: a.p.key.name }
        : { publishHistory: history as unknown as Prisma.InputJsonValue, publishedUrl: history[history.length - 1].url },   // 주소 없던 마지막 줄을 채웠으면 그 주소로
    });
    return { s, row, history, isNew };
  });
  if (!done) return v1Error(404, "마케팅 자료를 찾을 수 없습니다.", "NOT_FOUND");
  const { s, row, history, isNew } = done;
  await logAudit({ actorId: a.p.user.id, actorName: a.p.user.name, action: "MARKETING_PUBLISHED", targetType: "SUBMISSION", targetId: id, targetName: s.title, detail: `연동 키 「${a.p.key.name}」 · ${url}${note ? ` · ${note}` : ""}${isNew ? ` · ${history.length}회` : " · 같은 주소(메모만)"}` });
  if (isNew) {
    const { botSendDM } = await import("@/lib/bot");
    void botSendDM(s.userId, `📣 올려주신 마케팅 자료 「${s.title}」이(가) 블로그에 ${history.length === 1 ? "발행되었습니다" : `또 발행되었습니다(${history.length}번째 글)`}.\n${url}${note ? `\n${note}` : ""}`);
  }
  return NextResponse.json({ id: row.id, publishedAt: row.publishedAt, publishedUrl: row.publishedUrl, publishCount: history.length, isNew });
}
