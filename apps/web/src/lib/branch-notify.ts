// 지점 변경 알림 (2026-09-07 디렉터 지시)
//
// 왜: 출퇴근 위치 검사(지오펜스)는 **좌표가 있는 지점에만** 걸린다. 좌표 없이 지점을 만들면
// 그 지점 직원은 어디서든 출퇴근이 찍히는데, 화면에도 알림에도 아무것도 안 뜬다 —
// 관리자의 실수 한 번이 조용히 지나간다(2026-09-07 점검에서 확인).
// 지점 등록을 막지는 않는다(디렉터 판단: 관리자만 할 수 있으니까). 대신 **바로 알린다.**
//
// 알림 대상은 시스템 알림과 같은 담당자(관리자·김태석본부장) — `notifyTargets.system`.
import { prisma } from "@/lib/db";

const NL = "\n";

type BranchLike = {
  name: string;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  radius?: number | null;
  isActive?: boolean;
};

/** 위치 검사가 실제로 걸리는 지점인가 — 좌표가 둘 다 있어야 한다. */
function hasGeofence(b: BranchLike): boolean {
  return b.latitude != null && b.longitude != null;
}

/**
 * 지점 변경을 담당자에게 알린다.
 *
 * 알림 실패가 지점 등록을 되돌리면 안 되므로 **응답 뒤에** 보낸다. 다만 조용히 삼키지 않는다 —
 * 이 알림이 안 가면 좌표 누락을 잡을 방법이 아침 보고밖에 안 남는다.
 */
export async function notifyBranchChange(
  kind: "created" | "updated" | "deactivated",
  branch: BranchLike,
  actorName: string,
  extra?: string
): Promise<void> {
  try {
    const geo = hasGeofence(branch);
    const head =
      kind === "created" ? "🏢 지점이 등록되었습니다"
      : kind === "deactivated" ? "🏢 지점이 비활성 처리되었습니다"
      : "🏢 지점 정보가 바뀌었습니다";

    const lines: string[] = [`지점: ${branch.name}`];
    if (branch.address) lines.push(`주소: ${branch.address}`);
    if (kind !== "deactivated") {
      lines.push(`반경: ${branch.radius ?? 100}m`);
      // ⚠ 이 줄이 이 알림의 존재 이유다. 좌표가 없으면 위치 검사가 통째로 꺼진다.
      lines.push(
        geo
          ? "출퇴근 위치 검사: ✅ 적용됩니다"
          : "출퇴근 위치 검사: ⚠️ 없음 — 이 지점 직원은 **어디서든** 출퇴근이 찍힙니다"
      );
    } else {
      // 비활성 지점도 위치 검사가 꺼진다(clock-in 이 isActive:true 만 조회한다)
      lines.push("출퇴근 위치 검사: ⚠️ 없음 — 비활성 지점은 위치 검사가 걸리지 않습니다");
    }
    if (extra) lines.push(extra);
    lines.push(`처리: ${actorName}`);

    const tail = geo && kind !== "deactivated"
      ? ""
      : NL + NL + "관리자 페이지 > 지점 관리에서 주소를 넣으면 좌표가 자동으로 채워집니다.";

    const text = head + NL + NL + lines.join(NL) + tail;

    const { getNotifyRecipients } = await import("@/lib/notify-targets");
    const { botSendDM } = await import("@/lib/bot");
    const targets = await getNotifyRecipients("system");
    let sent = 0;
    for (const id of targets) {
      try { await botSendDM(id, text); sent++; } catch { /* 한 명 실패가 나머지를 막지 않게 */ }
    }
    if (sent === 0 && targets.length > 0) {
      console.error(`[branch] 지점 변경 알림을 아무에게도 보내지 못했습니다 (대상 ${targets.length}명)`);
      await prisma.systemErrorLog.create({
        data: {
          path: "/api/branches (지점 변경 알림)", method: "BOT",
          message: `지점 변경 알림 발송 실패 — ${branch.name} (${kind}), 대상 ${targets.length}명 전원 실패`,
        },
      }).catch(() => {});
    }
  } catch (e) {
    console.error("[branch] 지점 변경 알림 오류:", e);
  }
}
