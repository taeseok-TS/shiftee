import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

// 결재 알림 강제발송 정책 조회 (관리자)
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role !== "ADMIN") return NextResponse.json({ error: "관리자만 접근할 수 있습니다." }, { status: 403 });

  const force = await prisma.appSetting.findUnique({ where: { key: "forceApprovalNotify" } });
  return NextResponse.json({ forceApprovalNotify: force?.value === "true" });
}

// 결재 알림 강제발송 정책 변경 (관리자)
export async function PATCH(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role !== "ADMIN") return NextResponse.json({ error: "관리자만 접근할 수 있습니다." }, { status: 403 });

  const { forceApprovalNotify } = (await request.json()) as { forceApprovalNotify?: boolean };
  if (typeof forceApprovalNotify !== "boolean")
    return NextResponse.json({ error: "forceApprovalNotify 값이 필요합니다." }, { status: 400 });

  await prisma.appSetting.upsert({
    where: { key: "forceApprovalNotify" },
    create: { key: "forceApprovalNotify", value: String(forceApprovalNotify) },
    update: { value: String(forceApprovalNotify) },
  });
  return NextResponse.json({ success: true, forceApprovalNotify });
}
