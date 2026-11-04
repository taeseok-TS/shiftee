import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { leaveInfo, leaveLabel } from "@/lib/leave-catalog";
import { isLeaveDeductible } from "@/lib/leave-types";
import { groupOfType } from "@/lib/leave-grant";

// 휴가 유형 바꾸기 — 본부(관리자) 전용(2026-11-04 개선 제안 #238 이예지: 「기타휴가(유급)」로 잘못 신청돼 승인된 걸 「포상휴가」로).
//  · 대기·승인 건만. **잔여에 손대지 않는 변경만** 받는다 — 일수를 세는 방식(하루·반차·반반차, 주말 포함 여부) · 연차 차감 여부 ·
//    보상휴가/대체휴일 그룹이 모두 같은 유형끼리. 그래서 차감·복구·부여 잔여가 바뀌지 않고, 결재 승인·취소 결재와 겹쳐도
//    (그쪽은 유형을 트랜잭션 밖에서 읽는다) 어느 유형으로 판정하든 결과가 같다(2026-11-04 검증 1~5·9).
//    연차 ↔ 미차감처럼 잔여가 바뀌는 변경은 취소한 뒤 새로 등록한다(취소 결재·대리 등록이 잔여를 맞춘다).
//  · 반차·반반차 오전↔오후는 그날 같은 시간대 휴가가 있으면 막는다(대리 등록과 같은 규칙, 검증 7).
//  · 본인 휴가는 다른 관리자가(결재 라우트의 본인 건 예외 금지와 같은 뜻, 검증 6).
//  · 감사 기록 + 당사자 DM + 본부 진행 알림.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role !== "ADMIN") return NextResponse.json({ error: "본부(관리자)만 휴가 유형을 바꿀 수 있습니다." }, { status: 403 });

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const to = typeof body.type === "string" ? body.type.trim() : "";
  const note = typeof body.reason === "string" ? body.reason.trim().slice(0, 200) : "";

  await (await import("@/lib/leave-catalog-db")).ensureLeaveCatalog().catch(() => {});   // 본부 유형 차감 여부(#216-1)

  const leave = await prisma.leaveRequest.findUnique({
    where: { id },
    select: { id: true, userId: true, type: true, status: true, days: true, startDate: true, endDate: true, user: { select: { name: true } } },
  });
  if (!leave) return NextResponse.json({ error: "신청 내역이 없습니다." }, { status: 404 });
  if (leave.userId === session.userId) return NextResponse.json({ error: "본인 휴가의 유형은 다른 관리자가 바꿔야 합니다." }, { status: 403 });
  if (leave.status !== "APPROVED" && leave.status !== "PENDING") return NextResponse.json({ error: "대기·승인된 휴가만 유형을 바꿀 수 있습니다." }, { status: 400 });
  if (!to || to === leave.type) return NextResponse.json({ error: "바꿀 유형을 골라주세요." }, { status: 400 });

  const from = leaveInfo(leave.type);
  const next = leaveInfo(to);
  if (!next) return NextResponse.json({ error: "없는 휴가 유형입니다." }, { status: 400 });
  if (!next.selectable && !next.adminOnly) return NextResponse.json({ error: "지금은 쓰지 않는 유형이라 고를 수 없습니다." }, { status: 400 });
  if (!from || !sameCounting(leave.type, to)) {
    return NextResponse.json({ error: "연차 차감·일수 셈법이 달라지는 변경이라 유형만 바꿀 수 없습니다. 취소한 뒤 새로 등록해 주세요." }, { status: 400 });
  }

  try {
    await prisma.$transaction(async (tx) => {
      // 오전↔오후가 바뀌면 그날 같은 시간대 휴가와 겹치는지 — 직원 잠금(대리 등록·최종 승인과 같은 키)을 잡고 본다
      if (slot(leave.type) !== slot(to)) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"leave-bal:" + leave.userId}))`;
        const others = await tx.leaveRequest.findMany({
          where: { userId: leave.userId, id: { not: id }, status: { in: ["PENDING", "APPROVED"] }, startDate: { lte: leave.endDate }, endDate: { gte: leave.startDate } },
          select: { type: true },
        });
        const clash = others.find((o) => leaveInfo(o.type)?.unit === "FULL" || slot(o.type) === slot(to));
        if (clash) throw new TypeConflict(`그날 이미 ${leaveLabel(clash.type)} 휴가가 있어 바꿀 수 없습니다.`);
      }
      // 조건부로 — 그 사이 승인·취소·다른 유형 변경이 있었으면 아무것도 하지 않는다
      const won = await tx.leaveRequest.updateMany({ where: { id, status: leave.status, type: leave.type }, data: { type: to } });
      if (won.count !== 1) throw new TypeConflict("휴가 상태가 바뀌었습니다. 새로고침 후 다시 해주세요.");
    });
  } catch (e) {
    if (e instanceof TypeConflict) return NextResponse.json({ error: e.message }, { status: 409 });
    throw e;
  }

  const ymd = (d: Date) => d.toISOString().slice(0, 10);
  const span = `${ymd(leave.startDate)} ~ ${ymd(leave.endDate)}, ${leave.days}일`;
  const change = `${leaveLabel(leave.type)} → ${leaveLabel(to)}`;
  // 유급 시간이 바뀌면(유급 ↔ 무급 등) 리포트의 유급 시간·급여 공제가 따라 바뀐다 — 알림·기록에 적는다(재검증 권고 1)
  const paid = from.paidHours !== next.paidHours ? `유급 시간 ${from.paidHours}시간 → ${next.paidHours}시간(급여 반영)` : "";
  await logAudit({
    actorId: session.userId, actorName: session.name, action: "LEAVE_TYPE_CHANGE",
    targetType: "LEAVE", targetId: id, targetName: leave.user?.name ?? null,
    detail: `휴가 유형 변경 ${change} (${span}, ${leave.status === "APPROVED" ? "승인" : "대기"}, 연차 변동 없음)${paid ? ` · ${paid}` : ""}${note ? ` · 사유: ${note}` : ""}`,
  });

  const { botSendDM, botNotifyAdminsProgress } = await import("@/lib/bot");
  botSendDM(leave.userId, `휴가 유형이 바뀌었습니다.\n\n${change}\n기간: ${span}\n연차 잔여는 바뀌지 않습니다.${paid ? `\n${paid}` : ""}${note ? `\n사유: ${note}` : ""}\n처리: ${session.name}`).catch(() => {});
  botNotifyAdminsProgress(`${leave.user?.name ?? "직원"} · 휴가 유형 변경 ${change} (${span}, 처리: ${session.name})`, [session.userId]).catch(() => {});

  return NextResponse.json({ success: true });
}

const slot = (t: string) => (t.endsWith("_AM") ? "AM" : t.endsWith("_PM") ? "PM" : null);

/** 잔여에 영향 없이 바꿀 수 있는 두 유형인가 — 화면(admin/leave 유형 바꾸기 창)의 선택지도 같은 판정을 catalog 로 한다 */
function sameCounting(a: string, b: string): boolean {
  const x = leaveInfo(a), y = leaveInfo(b);
  if (!x || !y) return false;
  return x.unit === y.unit && !!x.calendarDays === !!y.calendarDays
    && isLeaveDeductible(a) === isLeaveDeductible(b)
    && groupOfType(a) === groupOfType(b);
}

class TypeConflict extends Error {}
