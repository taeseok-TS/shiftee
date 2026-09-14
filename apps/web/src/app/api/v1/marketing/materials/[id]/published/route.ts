import { NextRequest, NextResponse } from "next/server";
import { authenticateApiKey, v1Error } from "@/lib/api-key";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

// 큐브마케팅이 블로그에 올린 뒤 결과를 되돌려준다 (회사 연동 키, marketing:publish)
//  JSON { url: "https://blog…", note?: "…" } — 같은 자료에 다시 보내면 주소를 갱신한다. 올린 직원에게 봇 DM.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const a = await authenticateApiKey(request, "marketing:publish", "write");
  if (a.ok === false) return a.res;
  if (a.p.key.kind !== "ORG") return v1Error(403, "회사 연동 키로만 쓸 수 있습니다.", "ORG_KEY_ONLY");
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const url = typeof body.url === "string" ? body.url.trim().slice(0, 500) : "";
  if (!/^https?:\/\/\S+$/i.test(url)) return v1Error(400, "url 은 http(s) 주소여야 합니다.", "BAD_URL");
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 300) : "";
  const s = await prisma.submission.findFirst({ where: { id, deletedAt: null, category: { group: "MARKETING" } }, include: { category: true } });
  if (!s) return v1Error(404, "마케팅 자료를 찾을 수 없습니다.", "NOT_FOUND");
  const first = !s.publishedAt;
  const row = await prisma.submission.update({ where: { id }, data: { publishedAt: new Date(), publishedUrl: url, publishedBy: a.p.key.name } });
  await logAudit({ actorId: a.p.user.id, actorName: a.p.user.name, action: "MARKETING_PUBLISHED", targetType: "SUBMISSION", targetId: id, targetName: s.title, detail: `연동 키 「${a.p.key.name}」 · ${url}${note ? ` · ${note}` : ""}` });
  const { botSendDM } = await import("@/lib/bot");
  void botSendDM(s.userId, `📣 올려주신 마케팅 자료 「${s.title}」이(가) 블로그에 ${first ? "발행되었습니다" : "다시 발행되었습니다"}.\n${url}${note ? `\n${note}` : ""}`);
  return NextResponse.json({ id: row.id, publishedAt: row.publishedAt, publishedUrl: row.publishedUrl });
}
