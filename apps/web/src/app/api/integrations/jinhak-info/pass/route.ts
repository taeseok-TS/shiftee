import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { personLabel } from "@/lib/person-label";
import { jinhakInfoSecret, signJinhakInfoPass, jinhakInfoEnterUrl } from "@/lib/jinhak-info-pass";

// 입학정보실(진학입시EX) 입장권 발급 — 2026-10-19 디렉터 결정: 큐브티에 속한 직원 전체(직원·원장·관리자, 숨김 계정 포함 예외 없음).
// 로그인 세션(getSession — 서명·무효화·재직·퇴사까지 본다)이 있는 사람에게만 60초짜리 입장권을 만들어 입장 주소를 돌려준다.
// ⚠ GET 이 아니라 POST — 무중단 배포 프록시(Caddy)가 GET 은 다시 보내므로, 발급처럼 매번 새것을 만드는 일은 POST 로 둔다.
// ⚠ 입장권·열쇠 값은 로그·감사 기록에 남기지 않는다. 응답은 저장(캐시)되지 않게 no-store.
const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401, headers: NO_STORE });

  const secret = jinhakInfoSecret();
  if (!secret) {
    // 열쇠가 아직 안 들어갔거나 짧다 — 값은 찍지 않는다
    console.warn("[jinhak-info] INFO_PASS_SECRET 미설정 또는 32자 미만 — 입장권 발급 안 함");
    return NextResponse.json({ error: "입학정보실 연결 준비 중입니다." }, { status: 503, headers: NO_STORE });
  }

  // 표시 이름은 DB 의 현재 이름·직급으로(토큰의 이름은 7일 전 것일 수 있다). 조회 실패면 토큰 이름으로
  let name = session.name || "";
  try {
    const u = await prisma.user.findUnique({ where: { id: session.userId }, select: { name: true, position: true } });
    if (u) name = personLabel(u) || u.name || name;
  } catch { /* 이름 조회 실패가 입장을 막지는 않는다 */ }

  const token = signJinhakInfoPass({ sub: session.userId, name }, secret);

  // 누가 언제 열었는지만 남긴다(입장권·열쇠 값은 남기지 않는다). 실패해도 입장은 막지 않는다(logAudit 내부 처리)
  await logAudit({ actorId: session.userId, actorName: session.name, action: "JINHAK_INFO_ENTER", targetType: "INTEGRATION", targetName: "입학정보실" });

  return NextResponse.json({ url: jinhakInfoEnterUrl(token) }, { headers: NO_STORE });
}
