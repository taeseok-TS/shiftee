// 시프티 요청 기록(보관) 열람 범위 — 목록 API 와 첨부 라우트가 **같은 함수**로 판정한다(둘이 갈리면 목록엔 보이는데 사진은 403, 또는 반대).
//  · ADMIN    : 전부
//  · MANAGER  : 담당 지점(lib/manager-branches — 대표 + 겸직) 직원 것 = 기록의 지점명이 담당 지점이거나, 매칭된 큐브티 사용자의 현재 소속이 담당 지점
//               (시프티 지점명과 큐브티 지점명이 다를 수 있어 둘 다 본다. 퇴사자도 포함 — 분쟁 조회가 목적이라 지점을 떠난 뒤에도 그 지점 기록은 원장이 본다)
//  · EMPLOYEE : userId 가 본인인 것만(매칭 안 된 기록은 아무 직원에게도 안 보인다)
// 원장·직원 화면은 아직 없다(2026-10-26) — API 권한만 준비.
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { JWTPayload } from "@/lib/auth";
import { getManagerBranches } from "@/lib/manager-branches";

/** 세션이 볼 수 있는 기록의 where 조각. 아무것도 못 보면 `{ id: { in: [] } }`(빈 결과) */
export async function shifteeScopeWhere(session: JWTPayload): Promise<Prisma.ShifteeRequestWhereInput> {
  if (session.role === "ADMIN") return {};
  if (session.role === "MANAGER") {
    const branches = await getManagerBranches(session.userId);
    if (branches.length === 0) return { id: { in: [] } };
    const users = await prisma.user.findMany({ where: { branch: { in: branches } }, select: { id: true } });
    return { OR: [{ branch: { in: branches } }, { userId: { in: users.map((u) => u.id) } }] };
  }
  return { userId: session.userId };
}

/** 기록 한 건을 이 세션이 볼 수 있는지 — 첨부 라우트용(목록 where 와 같은 기준) */
export async function canSeeShifteeRequest(session: JWTPayload, r: { userId: string | null; branch: string | null }): Promise<boolean> {
  if (session.role === "ADMIN") return true;
  if (session.role === "MANAGER") {
    const branches = await getManagerBranches(session.userId);
    if (branches.length === 0) return false;
    if (r.branch && branches.includes(r.branch)) return true;
    if (!r.userId) return false;
    const u = await prisma.user.findUnique({ where: { id: r.userId }, select: { branch: true } });
    return !!u?.branch && branches.includes(u.branch);
  }
  return !!r.userId && r.userId === session.userId;
}
