import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { kstTodayDateUTC } from "@/lib/kst";
import { consentEligibility, hasPendingOutRequest, kstHhmm } from "@/lib/missed-out";

export const dynamic = "force-dynamic";

// 퇴근 누락 안내(2026-10-07 #15) — 오늘 이전 7일 안에서 가장 최근의 「출근만 있고 퇴근이 없는」 날.
// 그날 퇴근 누락·기록 수정 요청이 이미 대기 중이면 다시 안내하지 않는다. 앱이 출퇴근 화면을 열 때 부른다.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  const today = kstTodayDateUTC();
  const att = await prisma.attendance.findFirst({
    where: {
      userId: session.userId,
      date: { lt: today, gte: new Date(today.getTime() - 7 * 86400_000) },
      clockIn: { not: null },
      clockOut: null,
      importBatch: null,   // 시프티에서 옮긴 기록은 퇴근 누락 안내 대상이 아니다
    },
    orderBy: { date: "desc" },
    select: { date: true, clockIn: true },
  });
  if (!att) return NextResponse.json({ missed: null });
  // 퇴근 쪽 요청(누락·수정·지점 밖/사진/본부 퇴근)이 대기 중이면 다시 안내하지 않는다
  if (await hasPendingOutRequest(session.userId, att.date)) return NextResponse.json({ missed: null });
  // 본인 동의로 처리할 퇴근 시각 — 관리자 자동 마감과 같은 기준(근무일정 퇴근 시각, 2026-10-17 디렉터 결정 · lib/missed-out)
  const ymd = att.date.toISOString().slice(0, 10);
  const elig = await consentEligibility(session.userId, att.clockIn!, ymd);
  const closeHhmm = kstHhmm(elig.close.at);
  return NextResponse.json({
    missed: {
      date: ymd, clockIn: att.clockIn,
      canConsent: elig.ok, consentReason: elig.ok ? null : (elig.reason ?? null),
      closeAt: elig.close.at,             // 동의하면 기록될 퇴근 시각 — 동의할 때 그대로 돌려보낸다(expectAt)
      closeHhmm,
      closeLabel: elig.close.label,       // 예: 「근무일정 퇴근 18:00」
      // 구버전 앱(OTA 전)은 「22:00 퇴근 동의」라고만 보여 준다 — 실제로 22:00 일 때만 버튼을 켠다(보이는 시각과 기록이 어긋나지 않게)
      can22: elig.ok && closeHhmm === "22:00",
      can22Reason: elig.ok && closeHhmm === "22:00" ? null
        : (elig.reason ?? `근태 규칙에 따른 퇴근 시각이 ${closeHhmm}입니다. 앱을 최신으로 업데이트하거나 「퇴근 처리 요청하기」로 넣어 주세요.`),
    },
  });
}
