import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

// 내 알림 설정 조회 — 결재 결과 알림 수신 여부 + 관리자 강제발송 여부(강제 시 토글 비활성 안내용)
// + 큐브티워크 채팅 알림 전체 끄기(workMuteAll — 메시지·투표·공지 푸시만 차단, 메시지 수신은 유지)
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const [user, force] = await Promise.all([
    prisma.user.findUnique({ where: { id: session.userId }, select: { notifyApproval: true, workMuteAll: true } }),
    prisma.appSetting.findUnique({ where: { key: "forceApprovalNotify" } }),
  ]);
  return NextResponse.json({
    notifyApproval: user?.notifyApproval ?? true,
    workMuteAll: user?.workMuteAll ?? false,
    forced: force?.value === "true",
  });
}

// 내 알림 설정 변경
export async function PATCH(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const { notifyApproval, workMuteAll } = (await request.json()) as {
    notifyApproval?: boolean;
    workMuteAll?: boolean;
  };
  if (typeof notifyApproval !== "boolean" && typeof workMuteAll !== "boolean")
    return NextResponse.json({ error: "변경할 알림 설정 값이 필요합니다." }, { status: 400 });

  const data: { notifyApproval?: boolean; workMuteAll?: boolean } = {};
  if (typeof notifyApproval === "boolean") data.notifyApproval = notifyApproval;
  if (typeof workMuteAll === "boolean") data.workMuteAll = workMuteAll;

  const updated = await prisma.user.update({
    where: { id: session.userId },
    data,
    select: { notifyApproval: true, workMuteAll: true },
  });
  return NextResponse.json({ success: true, ...updated });
}
