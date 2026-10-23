// 지점 직원 변동 알림(2026-10-23 디렉터 결정 — 원장 환경설정 「지점 직원 변동 알림」)
//
// 원장 담당 지점(대표 + 겸직, lib/manager-branches branchManagers)에 직원이 **입사 등록**되거나
// **퇴사 처리·비활성화·재입사**되면 그 지점 원장들에게 큐브티 봇 DM 한 통. 한꺼번에 여러 명이면 지점별 한 통으로 묶는다.
//  · 받는 사람: 그 지점 활성 원장 중 환경설정에서 이 알림을 켠 사람(저장이 없으면 켬 — lib/notify-prefs staffChangeOptedIn)
//    처리한 본인(actorId)·변동 당사자는 뺀다.
//  · 빼는 변동: 관리자(ADMIN) 계정, 지점이 없는 사람(휴직자 연동 등), 지점 관리에서 「통계 포함」을 끈 지점(본부·테스트지점 —
//    lib/employee-scope excludedBranchNames 와 같은 기준)
//  · **절대 던지지 않는다** — 알림 실패가 직원 저장을 실패시키면 안 된다. 호출부는 기다리지 않는다(void) — 푸시가 느려도 저장 응답이 늦어지지 않게.
import { prisma } from "@/lib/db";
import { kstTodayMidnight } from "@/lib/resign";

export type StaffChangeKind = "hire" | "resign" | "deactivate" | "rehire" | "resignCancel";
export type StaffChange = {
  kind: StaffChangeKind;
  userId: string;
  name: string;
  branch: string | null;
  /** 입사일(hire) 또는 퇴사일(resign) — @db.Date(UTC 자정) 값 그대로 */
  date?: Date | null;
  /** resign — 이미 넣어 둔 퇴사일을 바꾼 경우 그 전 날짜(「퇴사일이 바뀌었습니다」) */
  prevDate?: Date | null;
  /** resign — 바로 잠그는 퇴사 처리(앞날 퇴사일이어도 「퇴사 예정」이라 하지 않는다) */
  immediate?: boolean;
};

const ymd = (d: Date | null | undefined) => (d && !Number.isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : null);

function lineOf(c: StaffChange): string {
  const day = ymd(c.date);
  switch (c.kind) {
    case "hire": return `입사 등록됐습니다${day ? `(입사일 ${day})` : ""}`;
    case "rehire": return "재입사로 다시 등록됐습니다(퇴사 해제)";
    // 퇴사일 당일까지는 재직(lib/resign 기준) — 앞날이면 「퇴사 예정」
    case "resign":
      if (c.prevDate && ymd(c.prevDate) !== day) {
        // 지난 퇴사일을 앞날로 미루면 계정이 다시 살아난다 — 「다시 재직」으로 알린다(최종 검증 2)
        const today = kstTodayMidnight();
        if (c.prevDate < today && c.date && c.date >= today) return `다시 재직으로 바뀌었습니다(퇴사일 ${ymd(c.prevDate)} → ${day}, 퇴사 예정)`;
        return `퇴사일이 바뀌었습니다(${ymd(c.prevDate)} → ${day})`;
      }
      return !c.immediate && c.date && c.date >= kstTodayMidnight() ? `퇴사 예정으로 처리됐습니다(퇴사일 ${day})` : `퇴사 처리됐습니다${day ? `(퇴사일 ${day})` : ""}`;
    case "resignCancel": return "퇴사 예정이 취소됐습니다(계속 근무)";
    case "deactivate": return "계정이 비활성화됐습니다";
  }
}

export async function notifyStaffChanges(changes: StaffChange[], opts: { actorId?: string | null } = {}): Promise<void> {
  try {
    const list = changes.filter((c) => c.branch);
    if (!list.length) return;

    // 관리자 계정은 지점 인원이 아니다(본부 소속) — 역할은 DB 에서 다시 읽는다(호출부가 빠뜨려도 새지 않게)
    const roles = new Map(
      (await prisma.user.findMany({ where: { id: { in: list.map((c) => c.userId) } }, select: { id: true, role: true } }))
        .map((u) => [u.id, u.role as string]),
    );
    const { excludedBranchNames } = await import("@/lib/employee-scope");
    const excluded = new Set(await excludedBranchNames());

    const byBranch = new Map<string, StaffChange[]>();
    for (const c of list) {
      if (roles.get(c.userId) === "ADMIN" || excluded.has(c.branch!)) continue;
      byBranch.set(c.branch!, [...(byBranch.get(c.branch!) ?? []), c]);
    }
    if (!byBranch.size) return;

    const { branchManagers } = await import("@/lib/manager-branches");
    const { staffChangeOptedIn } = await import("@/lib/notify-prefs");
    const { botSendDM } = await import("@/lib/bot");

    for (const [branch, items] of byBranch) {
      try {
        const subjects = new Set(items.map((c) => c.userId));
        const managers = (await branchManagers(branch)).map((m) => m.id).filter((id) => id !== opts.actorId && !subjects.has(id));
        const targets = await staffChangeOptedIn(managers);
        if (!targets.length) continue;

        const text = items.length === 1
          ? `👥 [지점 직원 변동] ${items[0].name} 님이 ${branch} 지점에 ${lineOf(items[0])}.`
          : `👥 [지점 직원 변동] ${branch} 지점 ${items.length}명\n${items.slice(0, 30).map((c) => `· ${c.name} — ${lineOf(c)}`).join("\n")}${items.length > 30 ? `\n외 ${items.length - 30}명` : ""}`;
        // 순서대로 보낸다 — 한 사람 실패가 나머지를 막지 않는다(botSendDM 은 던지지 않고 false 를 돌려준다)
        for (const id of targets) await botSendDM(id, text).catch(() => false);
      } catch (e) {
        console.error("[staff-change] 지점 직원 변동 알림 오류:", branch, e);
      }
    }
  } catch (e) {
    console.error("[staff-change] 지점 직원 변동 알림 오류:", e);
  }
}
