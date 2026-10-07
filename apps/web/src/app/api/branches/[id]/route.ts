import { NextRequest, NextResponse } from "next/server";
import { getSession, bumpTokenVersionMany } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";


// 좌표 칸 검사 — 빈칸을 Number("") 로 바꾸면 **0, 0** 이 저장돼 그 지점 직원 전원의 출근이 막혔다(2026-10-06 QA 조사).
// undefined = 손대지 않음, null = 좌표 지우기(위치 검사 꺼짐 — 등록·수정 알림이 그 사실을 알린다), 그 밖엔 올바른 숫자만.
function parseCoord(v: unknown, kind: "lat" | "lng"): number | null | undefined | "bad" {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v === "string" && v.trim() === "") return "bad";
  const n = Number(v);
  const lim = kind === "lat" ? 90 : 180;
  if (n === 0) return null; // 0 은 좌표가 아니다 — 옛 버그로 0,0 이 저장된 지점이 있어 「없음」으로 다룬다(검증관 C1)
  if (!Number.isFinite(n) || Math.abs(n) > lim) return "bad";
  return n;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role !== "ADMIN") {
    return NextResponse.json({ error: "관리자만 지점을 수정할 수 있습니다." }, { status: 403 });
  }

  try {
    const { id } = await params;
    const { name, address, radius, latitude, longitude, countInStats, mainManagerId } = await request.json();

    if (!name) {
      return NextResponse.json({ error: "지점명은 필수입니다." }, { status: 400 });
    }
    const lat = parseCoord(latitude, "lat"), lng = parseCoord(longitude, "lng");
    if (lat === "bad" || lng === "bad" || (lat !== undefined && lng !== undefined && (lat === null) !== (lng === null))) {
      return NextResponse.json({ error: "위도·경도를 숫자로 입력해 주세요. (예: 37.4979, 127.0276) 비워 두면 저장되지 않습니다." }, { status: 400 });
    }

    const data = {
      name,
      address: address || null,
      radius: radius ? Number(radius) : 100,
      latitude: lat,
      longitude: lng,
      countInStats: countInStats === undefined ? undefined : !!countInStats, // 통계 포함 여부 (미전송 시 유지)
      // 메인 원장 — 빈 값이면 해제. 미전송이면 그대로 둔다.
      mainManagerId: mainManagerId === undefined ? undefined : (mainManagerId || null),
    };

    // 변경 이전 값 확보 — 이름은 User.branch 동기화용, 좌표.반경은 위치 검사 변화 판정용
    const before = await prisma.branch.findUnique({
      where: { id },
      select: {
        name: true, latitude: true, longitude: true, radius: true,
        mainManagerId: true,   // 메인 원장 변경을 감사 로그에 남기기 위해
      },
    });
    if (!before) return NextResponse.json({ error: "지점을 찾을 수 없습니다." }, { status: 404 });
    // 좌표가 있던 지점의 좌표를 비우면(화면은 빈칸을 null 로 보낸다) 위치 검사가 통째로 꺼진다 — 실수로 비운 것으로 보고 막는다.
    // 종전엔 null 이 Number(null)=0 으로 바뀌어 0,0 이 저장되고 그 지점 직원 전원의 출근이 막혔다(2026-10-06 QA 조사).
    // 좌표가 없던 지점은 지금처럼 null 그대로 둔다(통계 포함·메인 원장만 바꾸는 저장도 좌표를 같이 보낸다).
    const hadCoord = (v: number | null) => v != null && v !== 0;   // 0 은 옛 버그 값 — 좌표 없음으로 본다
    // 저장될 결과로 본다 — 한쪽만 보내도 기존 값과 합쳐 위도·경도 중 하나만 남으면 거절(그 지점은 위치 검사가 꺼지거나 0 이 섞인다)
    const nextLat = lat === undefined ? (hadCoord(before.latitude) ? before.latitude : null) : lat;
    const nextLng = lng === undefined ? (hadCoord(before.longitude) ? before.longitude : null) : lng;
    if ((nextLat === null) !== (nextLng === null)) {
      return NextResponse.json({ error: "위도와 경도를 둘 다 입력해 주세요." }, { status: 400 });
    }
    // 옛 버그 값 0 이 남아 있으면 이번 저장에서 함께 비운다(통계 포함만 바꾸는 저장 등 좌표를 안 보낸 경우)
    if (lat === undefined && before.latitude === 0) data.latitude = null;
    if (lng === undefined && before.longitude === 0) data.longitude = null;
    if ((lat === null && hadCoord(before.latitude)) || (lng === null && hadCoord(before.longitude))) {
      return NextResponse.json({ error: "위도·경도가 비어 있습니다. 좌표를 넣고 저장해 주세요. (좌표를 지우면 출퇴근 위치 검사가 꺼집니다)" }, { status: 400 });
    }

    // 다른 지점과의 중복 체크
    if (name) {
      const existing = await prisma.branch.findFirst({
        where: { name, id: { not: id }, isActive: true }
      });
      if (existing) {
        return NextResponse.json({ error: "이미 존재하는 지점명입니다." }, { status: 409 });
      }
    }


    /**
     * 메인 원장이 바뀌었으면 기록을 남긴다. "누가 누구의 결재자인가"를 바꾸는 조작이다.
     * ⚠ 이름 변경 경로가 조기 return 하므로 **두 경로 모두에서** 불러야 한다
     *   (2026-09-09 검증에서 한쪽만 불리는 것이 적발됐다).
     */
    const auditMainManager = async (branchName: string) => {
      if (mainManagerId === undefined || (mainManagerId || null) === before.mainManagerId) return;
      try {
        const nameOf = async (uid: string | null) =>
          uid ? (await prisma.user.findUnique({ where: { id: uid }, select: { name: true } }))?.name ?? uid : "(없음)";
        await logAudit({
          actorId: session.userId, actorName: session.name, action: "BRANCH_MAIN_MANAGER",
          targetType: "Branch", targetId: id, targetName: branchName,
          detail: `메인 원장 변경: ${await nameOf(before.mainManagerId)} → ${await nameOf(mainManagerId || null)}`,
        });
      } catch (e) {
        // 이름 조회가 실패해도 지점 저장은 이미 끝났다 — 여기서 500 을 내면 안 된다
        console.error("[branch] 메인 원장 감사 로그 실패:", e);
      }
    };

    // 지정하려는 사람이 **그 지점을 담당하는 활성 원장**인지 확인한다.
    // 아무나 못박으면 결재가 그 사람에게 걸린 채 멈춘다.
    if (mainManagerId) {
      const cand = await prisma.user.findUnique({
        where: { id: String(mainManagerId) },
        select: { role: true, isActive: true, branch: true, managerBranches: { select: { branchName: true } } },
      });
      // ⚠ 이름을 **동시에 바꾸는** 경우, 담당 지점은 아직 옛 이름이다(동기화는 아래에서 한다).
      //   새 이름만 보면 정당한 원장도 400 으로 거부된다(2026-09-09 검증에서 적발).
      const covered = cand
        ? [cand.branch, ...cand.managerBranches.map((b) => b.branchName)].filter(Boolean)
        : [];
      const covers = covered.includes(name) || covered.includes(before.name);
      if (!cand || cand.role !== "MANAGER" || !cand.isActive || !covers) {
        return NextResponse.json(
          { error: "메인 원장은 그 지점을 담당하는 활성 원장이어야 합니다." },
          { status: 400 }
        );
      }
    }


    if (before.name !== name) {
      // 토큰에 branch 가 박혀 있으므로, 이름을 바꾸기 **전에** 대상자를 잡아둔다.
      const affected = await prisma.user.findMany({ where: { branch: before.name }, select: { id: true } });

      // 지점명 변경: 소속 직원(퇴직자 포함)의 User.branch를 같은 트랜잭션으로 동기화
      const [branch, synced] = await prisma.$transaction([
        prisma.branch.update({ where: { id }, data }),
        prisma.user.updateMany({ where: { branch: before.name }, data: { branch: name } }),
        // 원장대행 지정도 지점명으로 묶여 있다 — 안 바꾸면 대행이 조용히 끊긴다(2026-10-07 검증 지적)
        prisma.approvalDelegate.updateMany({ where: { branch: before.name }, data: { branch: name } }),
        // 근무일정 템플릿의 지점 목록도 — 안 바꾸면 그 지점 전용 템플릿이 신청 화면에서 사라진다(5-가 검증)
        prisma.$executeRaw`UPDATE "ScheduleTemplate" SET "branches" = array_replace("branches", ${before.name}, ${name}), "updatedAt" = now() WHERE ${before.name} = ANY("branches")`,
      ]);
      // 옛 지점명이 박힌 토큰을 끊는다. 안 끊으면 그 사람들은 다시 로그인할 때까지
      // 없어진 지점명으로 조회돼 근태.직원 목록이 빈 채로 보인다.
      await bumpTokenVersionMany(affected.map((u) => u.id)).catch(() => {});

      await logAudit({
        actorId: session.userId,
        actorName: session.name,
        action: "BRANCH_RENAME",
        targetType: "Branch",
        targetId: id,
        targetName: name,
        detail: `${before.name}→${name}, 직원 ${synced.count}명 동기화`,
      });
      notifyIfGeofenceChanged(branch, before, session.name, `이름 변경 ${before.name}→${name}, 직원 ${synced.count}명 동기화`);
      await auditMainManager(branch.name);
      return NextResponse.json({ success: true, branch, syncedUsers: synced.count });
    }

    const branch = await prisma.branch.update({ where: { id }, data });
    await auditMainManager(branch.name);
    notifyIfGeofenceChanged(branch, before, session.name);
    return NextResponse.json({ success: true, branch });
  } catch (error) {
    console.error("지점 수정 실패:", error);
    return NextResponse.json({ error: "지점을 수정할 수 없습니다." }, { status: 500 });
  }
}

/**
 * 위치 검사에 영향을 주는 변경일 때만 알린다 (2026-09-07).
 * 좌표가 생기거나 사라지거나 옮겨지거나 반경이 바뀌면 **출퇴근이 허용되는 범위가 달라진다.**
 * 통계 포함 여부 같은 변경까지 알리면 소음이 되어 정작 중요한 것이 묻힌다.
 */
function notifyIfGeofenceChanged(
  after: { name: string; address: string | null; latitude: number | null; longitude: number | null; radius: number },
  before: { latitude: number | null; longitude: number | null; radius: number },
  actorName: string,
  extra?: string
) {
  const moved =
    (before.latitude == null) !== (after.latitude == null) ||
    (before.longitude == null) !== (after.longitude == null) ||
    before.latitude !== after.latitude ||
    before.longitude !== after.longitude ||
    before.radius !== after.radius;
  if (!moved && !extra) return;
  void (async () => {
    const { notifyBranchChange } = await import("@/lib/branch-notify");
    await notifyBranchChange("updated", after, actorName, extra);
  })();
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role !== "ADMIN") {
    return NextResponse.json({ error: "관리자만 지점을 삭제할 수 있습니다." }, { status: 403 });
  }

  try {
    const { id } = await params;
    const branch = await prisma.branch.update({ where: { id }, data: { isActive: false } });
    // ⚠ 비활성 지점은 clock-in 의 `isActive: true` 조회에서 빠져 **위치 검사가 꺼진다.**
    //   등록만큼 중요한 사건이라 함께 알린다.
    void (async () => {
      const { notifyBranchChange } = await import("@/lib/branch-notify");
      await notifyBranchChange("deactivated", branch, session.name);
    })();
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("지점 삭제 실패:", error);
    return NextResponse.json({ error: "지점을 삭제할 수 없습니다." }, { status: 500 });
  }
}
