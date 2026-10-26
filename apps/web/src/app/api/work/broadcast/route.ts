import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { emitWork } from "@/lib/work-events";
import { notifyNewMessage } from "@/lib/work-notify";
import { findOrCreateDM } from "@/lib/work-dm";
import { hiddenIdsFor } from "@/lib/hidden-accounts";
import { firstUnattachableWorkUrl, UNATTACHABLE_MSG } from "@/lib/work-file-access";
import { logAudit } from "@/lib/audit";

// 「한 번에 보내기」 — 관리자(서브 관리자 포함)가 여러 사람(DM)·여러 그룹방에 같은 글을 한 번에 보낸다(2026-10-26 디렉터 승인).
//  · 사람: 나와 그 사람의 DM 방을 찾거나 만들어(lib/work-dm) 거기에 보낸다 — 새 채팅 「1:1 대화」와 같은 방
//  · 방: 내가 멤버인 그룹방(CHANNEL)만. DM 은 사람으로 고른다
//  · 방마다 메시지 1건 + 기존 보내기와 같은 마무리(SSE 신호 · 푸시). 한 방이 실패해도 나머지는 간다
//  · 상한: 사람 200 · 방 30(중복 제거 뒤), 본문 4000자. 스티커는 받지 않는다
const MAX_USERS = 200;
const MAX_CHANNELS = 30;
const MAX_CONTENT = 4000;
const CONCURRENCY = 5;

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role !== "ADMIN") return NextResponse.json({ error: "관리자만 쓸 수 있습니다." }, { status: 403 });

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "요청 본문이 올바르지 않습니다." }, { status: 400 });
  const { userIds, channelIds, content, fileUrl, fileName, fileType } = body as {
    userIds?: unknown; channelIds?: unknown; content?: unknown; fileUrl?: unknown; fileName?: unknown; fileType?: unknown;
  };

  const strList = (v: unknown) => Array.from(new Set((Array.isArray(v) ? v : []).filter((x): x is string => typeof x === "string" && x.length > 0)));
  const uids = strList(userIds);
  const cids = strList(channelIds);
  if (uids.length + cids.length === 0) return NextResponse.json({ error: "받는 사람이나 채팅방을 골라 주세요." }, { status: 400 });
  if (uids.length > MAX_USERS) return NextResponse.json({ error: `사람은 한 번에 ${MAX_USERS}명까지입니다.` }, { status: 400 });
  if (cids.length > MAX_CHANNELS) return NextResponse.json({ error: `채팅방은 한 번에 ${MAX_CHANNELS}개까지입니다.` }, { status: 400 });

  const text = typeof content === "string" ? content.trim() : "";
  if (text.length > MAX_CONTENT) return NextResponse.json({ error: `본문은 ${MAX_CONTENT}자까지입니다.` }, { status: 400 });
  if (fileUrl !== undefined && fileUrl !== null && typeof fileUrl !== "string")
    return NextResponse.json({ error: "첨부 파일 경로가 올바르지 않습니다." }, { status: 400 });
  if (fileName !== undefined && fileName !== null && typeof fileName !== "string")
    return NextResponse.json({ error: "첨부 파일 이름이 올바르지 않습니다." }, { status: 400 });
  if (fileType !== undefined && fileType !== null && typeof fileType !== "string")
    return NextResponse.json({ error: "첨부 파일 종류가 올바르지 않습니다." }, { status: 400 });
  // 스티커는 그림 하나가 한 메시지라 한 번에 보내기로는 받지 않는다(경로도 /api/uploads/emoticons/ 로 다르다)
  if (fileType === "sticker") return NextResponse.json({ error: "이모티콘은 한 번에 보내기로 보낼 수 없습니다." }, { status: 400 });
  // 첨부 주소 검사 — channels/[id]/messages POST 의 okAttach 규칙 그대로(work 군만, 조각 5개)
  const okAttach = (u: unknown): u is string =>
    typeof u === "string" &&
    u.startsWith("/api/uploads/work/") &&
    !u.includes("..") &&
    !u.includes("\\") &&
    u.split("?")[0].split("/").length === 5;
  if (fileUrl && !okAttach(fileUrl))
    return NextResponse.json({ error: "첨부 파일 경로가 올바르지 않습니다." }, { status: 400 });
  if (!text && !fileUrl) return NextResponse.json({ error: "글이나 첨부 중 하나는 있어야 합니다." }, { status: 400 });
  // 보내는 사람이 지금 볼 수 있는 파일만 — messages POST 와 같은 검사
  if (fileUrl) {
    const bad = await firstUnattachableWorkUrl([fileUrl], { userId: session.userId, role: session.role });
    if (bad) return NextResponse.json({ error: UNATTACHABLE_MSG }, { status: 403 });
  }

  // 사람 — members API 와 같은 기준(재직·개발자 영역 숨김 계정 제외), 나 자신 제외
  const hidden = await hiddenIdsFor({ userId: session.userId });
  const users = uids.length
    ? await prisma.user.findMany({
        where: { AND: [{ id: { in: uids } }, { id: { notIn: [session.userId, ...hidden] } }], isActive: true, deletedAt: null },
        select: { id: true, name: true },
      })
    : [];
  // 방 — 내가 멤버인 그룹방만(삭제된 방 제외). 기본 '전체' 방은 messages 라우트 assertAccess 와 같이 모두에게 열려 있다
  const channels = cids.length
    ? await prisma.workChannel.findMany({
        where: { id: { in: cids }, type: "CHANNEL", deletedAt: null, OR: [{ isDefault: true }, { members: { some: { userId: session.userId } } }] },
        select: { id: true, name: true, type: true },
      })
    : [];
  if (users.length + channels.length === 0)
    return NextResponse.json({ error: "보낼 수 있는 사람이나 채팅방이 없습니다." }, { status: 400 });
  // 골랐지만 대상이 안 된 것(퇴사·비활성 사용자, 내가 없는 방 등)은 조용히 빠지지 않게 결과에 남긴다
  const dropped = uids.length - users.length + (cids.length - channels.length);

  // 한 방에 보내기 — 메시지 생성 → SSE 신호 → 푸시(messages POST 의 finishSend 와 같은 마무리).
  // 푸시 실패는 보내기 실패로 치지 않는다(기존도 응답을 막지 않고 기록만 한다)
  const sendTo = async (channel: { id: string; name: string; type: string }) => {
    const message = await prisma.workMessage.create({
      data: {
        channelId: channel.id,
        userId: session.userId,
        content: text,
        fileUrl: (fileUrl as string | null | undefined) ?? null,
        fileName: (fileName as string | null | undefined) ?? null,
        fileType: (fileType as string | null | undefined) ?? null,
      },
      include: { user: { select: { name: true } } },
    });
    emitWork({ type: "message", channelId: channel.id, senderId: session.userId, msgId: message.id });
    try {
      await notifyNewMessage(channel, message, session.userId);
    } catch (e) {
      console.error("[push] notify 오류(한 번에 보내기):", e);
    }
  };

  type Target = { kind: "user" | "channel"; name: string; run: () => Promise<void> };
  const targets: Target[] = [
    ...users.map((u) => ({
      kind: "user" as const,
      name: u.name,
      run: async () => {
        const dm = await findOrCreateDM(session.userId, u.id);
        // 알림 제목은 받는 사람 화면의 방 이름(DM 은 보낸 사람 이름) — 일반 DM 보내기도 channel.name("DM")을 쓰므로 그대로 둔다
        await sendTo({ id: dm.id, name: dm.name, type: dm.type });
      },
    })),
    ...channels.map((c) => ({ kind: "channel" as const, name: c.name, run: () => sendTo(c) })),
  ];

  // 동시 5개씩 묶어 순차 처리 — 한 방 실패가 나머지를 막지 않게 allSettled
  let sentUsers = 0;
  let sentChannels = 0;
  const failed: string[] = [];
  const okNames: string[] = [];
  for (let i = 0; i < targets.length; i += CONCURRENCY) {
    const chunk = targets.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(chunk.map((t) => t.run()));
    results.forEach((r, idx) => {
      const t = chunk[idx];
      if (r.status === "fulfilled") {
        if (t.kind === "user") sentUsers++;
        else sentChannels++;
        okNames.push(t.name);
      } else {
        console.error("[broadcast] 보내기 실패:", t.kind, t.name, r.reason);
        failed.push(t.name);
      }
    });
  }
  if (dropped > 0) failed.push(`보낼 수 없는 대상 ${dropped}건`);

  const bodyHead = text ? text.slice(0, 100) : (typeof fileName === "string" && fileName) ? `(첨부) ${fileName.slice(0, 80)}` : "(첨부)";
  await logAudit({
    actorId: session.userId,
    actorName: session.name,
    action: "WORK_BROADCAST",
    targetType: "WorkChannel",
    targetName: okNames.join(", ").slice(0, 200),
    detail: `한 번에 보내기 ${sentUsers}명 · ${sentChannels}방${failed.length ? ` · 실패 ${failed.join(", ")}` : ""}: ${bodyHead}`,
  });

  return NextResponse.json({ sentUsers, sentChannels, failed });
}
