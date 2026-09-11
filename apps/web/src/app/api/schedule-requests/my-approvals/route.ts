import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { kstTodayMidnight } from "@/lib/resign";
import { getManagerBranches } from "@/lib/manager-branches";
import { scheduleCancelDenial, cancelFlags, type CancelViewer } from "@/lib/leave-cancel";
import { cancelViewerFor } from "@/lib/cancel-viewer";

// 내가 결재해야 하는 근무일정 신청 목록
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const myBranches = session.role === "MANAGER" ? await getManagerBranches(session.userId) : [];
  const viewer = await cancelViewerFor(session);
  const steps = await prisma.scheduleApprovalStep.findMany({
    where: {
      status: "PENDING",
      // 본인 신청은 본인 결재함에 뜨지 않는다. 원장 신청에 원장 단계가 생기면서
      // 자기 것이 자기 결재함에 뜨는데, 누르면 403 이다 — 누를 수 없는 버튼을
      // 보여주지 않는다(2026-09-09 검증에서 적발).
      scheduleRequest: { userId: { not: session.userId } },
      // 관리자는 **대기 중인 모든 단계**를 본다. 결재 요청 DM 이 전체 관리자에게
      // 가는데(디렉터 지시) 결재함에는 ADMIN 단계만 보이면, 받아놓고 열었을 때
      // 빈 화면이 된다(2026-09-09 검증에서 적발). 관리자는 어차피 어떤 건이든
      // 대신 처리할 수 있다.
      // ⚠ `{ id: { not: "" } }` 같은 표현을 쓰지 말 것 — 의도가 안 드러나고,
      //    nullable 컬럼에 그대로 복사하면 Prisma 의 not 이 NULL 행을 조용히 뺀다.
      ...(session.role === "ADMIN"
        ? {}
        : {
            OR: [
              { approverId: session.userId }, // 레거시 고정 결재자
              // 사람을 못박지 않은 지점 단계만 — 메인 원장에게 못박힌 건은 그 사람
              // 결재함에만 뜬다(위 approverId 절이 잡는다). 안 그러면 같은 지점
              // 두 번째 원장에게도 보이는데 누르면 403 이다.
              ...(session.role === "MANAGER"
                ? [{ approverRole: "MANAGER", branch: { in: myBranches }, approverId: null }]
                : []),
            ],
          }),
    },
    include: {
      scheduleRequest: {
        include: {
          user: { select: { id: true, name: true, department: true, position: true, branch: true, role: true } },   // role 은 취소 판정용 — 응답에서 뺀다
          approvalSteps: {
            include: {
              approver: { select: { id: true, name: true, position: true, branch: true } },
            },
            orderBy: { order: "asc" },
          },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  // 관리자: 결재라인이 없는 대기 신청 + **담당 원장이 없어 멈춘 신청**도 결재함에 표시.
  // 종전에는 원장 단계에서 멈춘 신청이 관리자 결재함에 뜨지 않아, 그 지점 원장이
  // 퇴사.비활성되면 **아무에게도 보이지 않고 영구 정지**했다(2026-09-08 검증에서 적발).
  if (session.role === "ADMIN") {
    // ⚠ 고아 원장 단계를 따로 모으던 블록은 걷어냈다. 관리자는 위에서 이미 대기 중인
    //   **모든** 단계를 보므로 중복이었고, 그 보조 조회만 "본인 신청 제외"를 우회해서
    //   자기 신청이 자기 결재함에 뜰 수 있었다(2026-09-09 검증에서 적발).

    const noLineRequests = await prisma.scheduleRequest.findMany({
      where: {
        status: "PENDING",
        approvalSteps: { none: {} },
        userId: { not: session.userId },   // 본인 신청은 결재함에 띄우지 않는다
      },
      include: {
        user: { select: { id: true, name: true, department: true, position: true, branch: true, role: true } },   // role 은 취소 판정용 — 응답에서 뺀다
        approvalSteps: {
          include: {
            approver: { select: { id: true, name: true, position: true, branch: true } },
          },
          orderBy: { order: "asc" },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    const directSteps = noLineRequests.map((req) => ({
      id: `direct-${req.id}`,
      order: 0,
      status: "PENDING",
      scheduleRequest: req,
    }));

    return NextResponse.json({ steps: [...steps, ...directSteps].map((st) => withCancel(viewer, st)) });
  }

  return NextResponse.json({ steps: steps.map((st) => withCancel(viewer, st)) });
}


type InboxSchedule = {
  userId: string;
  status: string;
  endDate: Date;
  user: { id: string; name: string; department: string | null; position: string | null; branch: string | null; role: string };
};

// 취소 버튼 판정(canCancel · cancelBlock)을 실어 보낸다 — 취소 라우트와 **같은 함수**.
// 판정에 쓴 role 은 응답에서 뺀다(휴가 결재함과 짝).
function withCancel<S extends { scheduleRequest: InboxSchedule }>(viewer: CancelViewer, s: S) {
  const r = s.scheduleRequest;
  const u = r.user;
  return {
    ...s,
    scheduleRequest: {
      ...r,
      user: { id: u.id, name: u.name, department: u.department, position: u.position, branch: u.branch },
      ...cancelFlags(scheduleCancelDenial(viewer, r)),
    },
  };
}
