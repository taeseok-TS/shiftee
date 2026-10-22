import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { checkContractPassword } from "@/lib/contract-pw";
import { logAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { canViewSalary, issueSalaryKey, salaryCookie, SALARY_UNLOCK_MIN, NO_STORE } from "@/lib/salary-access";

export const dynamic = "force-dynamic";

// 연봉 화면 들어가기 — 로그인 비밀번호 재확인(2026-10-22 디렉터). 맞으면 30분 열쇠(httpOnly 쿠키), 열람은 변경 로그에 남긴다.
// 틀린 횟수 제한은 전자계약 본인 확인과 같은 표(5번 → 15분 잠금). 응답은 401 이 아니라 400/429(앱·화면이 로그인 만료로 보지 않게)
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401, headers: NO_STORE });
  if (!(await canViewSalary(session))) return NextResponse.json({ error: "연봉 화면을 볼 권한이 없습니다." }, { status: 403, headers: NO_STORE });
  const body = await request.json().catch(() => null);
  const password = typeof body?.password === "string" ? body.password : "";
  if (!password) return NextResponse.json({ error: "비밀번호를 입력해 주세요." }, { status: 400, headers: NO_STORE });
  const r = await checkContractPassword(session.userId, password);
  if (!r.ok) {
    await logAudit({ actorId: session.userId, actorName: session.name, action: "SALARY_UNLOCK_FAIL", targetType: "SALARY", targetId: null, targetName: "연봉", detail: r.code === "PASSWORD_LOCKED" ? "잠김(여러 번 틀림)" : "비밀번호 틀림" });
    return NextResponse.json({ error: r.error, code: r.code }, { status: r.status ?? 400, headers: NO_STORE });
  }
  // 누가 · 언제 · 몇 명분을 봤는지(본부 10/22 답장 9) — 연 순간 API 가 내려보내는 사람 수(사번 기준, 퇴사자 포함). 실명은 logAudit 이 DB 이름으로 남긴다
  const people = await prisma.salaryRecord.findMany({ distinct: ["empNo"], select: { empNo: true } }).then((r) => r.length).catch(() => null);
  await logAudit({ actorId: session.userId, actorName: session.name, action: "SALARY_UNLOCK", targetType: "SALARY", targetId: null, targetName: "연봉", detail: `연봉 화면 열람(${SALARY_UNLOCK_MIN}분)${people !== null ? ` · ${people}명분` : ""}` });
  const res = NextResponse.json({ ok: true, minutes: SALARY_UNLOCK_MIN }, { headers: NO_STORE });
  res.cookies.set(salaryCookie(await issueSalaryKey(session), SALARY_UNLOCK_MIN * 60));
  return res;
}

// 잠그기(화면의 「잠그기」) — 열쇠 쿠키를 지운다
export async function DELETE() {
  const res = NextResponse.json({ ok: true }, { headers: NO_STORE });
  res.cookies.set(salaryCookie("", 0));
  return res;
}
