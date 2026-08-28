import { prisma } from "@/lib/db";
import { hrBotSendDM } from "@/lib/bot";
import { getAppUrl, approvalPageUrl } from "@/lib/app-url";

/**
 * 전자계약 알림 정리 (#136) + 미결재·미서명 리마인더 (#128)
 * — QA 이예지대리·김가산 확정 정책 (2026-08-27)
 *
 * 규칙:
 * - 각 결재 단계 승인 시 작성자(createdBy)에게 진행 DM (작성자가 그 단계 결재자면 생략)
 * - 전체 완료 시 작성자 + 결재 참여 내부 결재자 전원에게 완료 DM(중복 제거).
 *   근로자가 마지막 스텝이었으면 근로자 완료 DM 생략(본인이 방금 서명해 이미 안다)
 * - createdBy 없는 기존 계약은 작성자 알림 생략(결재 참여자 알림은 유지)
 */

const KST_MS = 9 * 60 * 60 * 1000;

const ROLE_LABEL: Record<string, string> = { ADMIN: "본부", MANAGER: "원장", EMPLOYEE: "직원" };

function kstStamp(d: Date): string {
  const k = new Date(d.getTime() + KST_MS);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${k.getUTCFullYear()}-${p(k.getUTCMonth() + 1)}-${p(k.getUTCDate())} ${p(k.getUTCHours())}:${p(k.getUTCMinutes())}`;
}

// 인사봇 알림에 넣는 역할별 계약 화면 링크 (#167) — 모든 알림이 같은 규칙을 쓴다.
// 원장(MANAGER)은 /admin 접근이 막혀 있어 자체 결재함으로 (검증관 지적 2026-08-25)
export function contractPageLink(role?: string | null): string {
  if (role === "EMPLOYEE") return "/contracts";
  return role === "MANAGER" ? "/manager/team-contracts" : "/admin/contracts";
}

// 완료 확인 링크
function completionLink(role?: string | null): string {
  return contractPageLink(role);
}

// 결재 단계 승인 → 작성자(createdBy)에게 진행 알림. 작성자가 그 단계 결재자 본인이면 생략.
export function notifyStepApprovedToCreator(opts: {
  createdBy: string | null;
  approverId: string;
  approverRole?: string | null;
  order: number;
  title: string;
  targetName: string;
}) {
  if (!opts.createdBy || opts.createdBy === opts.approverId) return;
  const createdBy = opts.createdBy;
  const roleLabel = ROLE_LABEL[opts.approverRole || ""] || "결재자";
  // 작성자 역할에 맞는 바로가기까지 붙여서 보낸다 (#167)
  (async () => {
    const creator = await prisma.user.findUnique({ where: { id: createdBy }, select: { role: true } });
    await hrBotSendDM(
      createdBy,
      `🖋 ${opts.order}단계(${roleLabel}) 결재 완료 — 「${opts.title}」 대상 ${opts.targetName}\n확인: ${getAppUrl()}${contractPageLink(creator?.role)}`
    );
  })().catch((e) => console.error("[contract] 작성자 단계 알림 오류:", e));
}

// 전체 완료 → 작성자 + 결재 참여 내부 결재자 전원 (+마지막 스텝이 아니었던 근로자). 중복 제거.
// 계약 상태 갱신(SIGNED) 후에 호출할 것 — DB에서 최신 상태를 다시 읽는다.
export async function notifyContractCompleted(contractId: string) {
  try {
    const contract = await prisma.contract.findUnique({
      where: { id: contractId },
      include: {
        user: { select: { id: true, name: true } },
        approvalLine: {
          include: {
            steps: {
              orderBy: { order: "asc" },
              include: { approver: { select: { id: true, name: true, role: true } } },
            },
          },
        },
      },
    });
    if (!contract?.approvalLine) return;
    const steps = contract.approvalLine.steps;
    const targetName = contract.externalName || contract.user.name;
    const doneAt = kstStamp(contract.signedAt || new Date());
    const appUrl = getAppUrl();
    // 외부 계약은 근로자 계정이 없음(userId=작성 관리자) — 근로자 DM 없음
    const employeeId = contract.externalName ? null : contract.userId;
    const lastStep = steps[steps.length - 1];
    const employeeWasLast = !!employeeId && lastStep?.approverId === employeeId;

    const sent = new Set<string>();

    // 근로자 완료 DM — 근로자가 마지막 스텝이었으면 생략 (#136)
    if (employeeId && !employeeWasLast) {
      sent.add(employeeId);
      hrBotSendDM(
        employeeId,
        `✅ 전자계약 완료\n「${contract.title}」 결재가 모두 완료되었습니다.\n완료: ${doneAt} (KST)\n확인: ${appUrl}/contracts`
      ).catch((e) => console.error("[contract] 완료 DM 오류:", e));
    }

    const adminMsg = (role?: string | null) =>
      `✅ 전자계약 완료\n「${contract.title}」 — 대상: ${targetName}\n완료: ${doneAt} (KST)\n확인: ${appUrl}${completionLink(role)}`;

    // 결재 참여 내부 결재자 전원 (근로자 스텝 제외, 외부 스텝은 approverId=null이라 자연 제외)
    for (const stp of steps) {
      if (!stp.approverId || stp.approverId === employeeId || sent.has(stp.approverId)) continue;
      sent.add(stp.approverId);
      hrBotSendDM(stp.approverId, adminMsg(stp.approver?.role)).catch((e) =>
        console.error("[contract] 완료 DM 오류:", e)
      );
    }

    // 작성자 — 결재에 참여하지 않았어도 완료 통지 (createdBy 없는 기존 계약은 생략)
    if (contract.createdBy && !sent.has(contract.createdBy) && contract.createdBy !== employeeId) {
      const creator = await prisma.user.findUnique({
        where: { id: contract.createdBy },
        select: { role: true },
      });
      if (creator) {
        hrBotSendDM(contract.createdBy, adminMsg(creator.role)).catch((e) =>
          console.error("[contract] 완료 DM 오류:", e)
        );
      }
    }
  } catch (e) {
    console.error("[contract] 완료 알림 오류:", e);
  }
}

// ─── 미서명·미결재 리마인더 (#128) ─────────────────────────────
// 매일 KST 10시경 1회 실행(스케줄러에서 시각 판정) — PENDING 24시간 경과 스텝에
// 담당자 리마인더 + 작성자 지연 현황 DM. remindedAt으로 하루 1회 보장.
export async function runContractReminders() {
  const now = new Date();
  const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  // 오늘(KST) 시작 시각(UTC) — remindedAt이 오늘이면 스킵
  const k = new Date(now.getTime() + KST_MS);
  const kstTodayStart = new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate()) - KST_MS);

  const steps = await prisma.contractApprovalStep.findMany({
    where: {
      status: "PENDING",
      updatedAt: { lt: cutoff }, // PENDING이 된 시점 근사치 = 스텝 최종 갱신 시각
      OR: [{ remindedAt: null }, { remindedAt: { lt: kstTodayStart } }],
      approvalLine: { contract: { status: { in: ["SENT", "APPROVED"] } } },
    },
    take: 200,
    include: {
      approver: { select: { id: true, name: true, role: true } },
      approvalLine: {
        include: {
          contract: {
            select: {
              id: true, title: true, createdBy: true, userId: true, externalName: true,
              user: { select: { name: true } },
            },
          },
        },
      },
    },
  });
  if (!steps.length) return;

  const appUrl = getAppUrl();
  const creatorRoles = new Map<string, string | null>(); // 작성자 역할 캐시 (링크 분기용 #167)
  let sentCount = 0;
  for (const step of steps) {
    try {
      const contract = step.approvalLine.contract;
      const days = Math.max(1, Math.floor((now.getTime() - step.updatedAt.getTime()) / (24 * 60 * 60 * 1000)));
      const isEmployeeStep = !!step.approverId && step.approverId === contract.userId && !contract.externalName;

      // 담당자 리마인더 — 외부 스텝(approverId null)은 DM 불가, 작성자 통지만
      if (step.approverId) {
        const msg = isEmployeeStep
          ? `⏰ 서명 리마인더 — 「${contract.title}」 ${days}일째 대기 중\n${appUrl}/contracts`
          : `⏰ 미결재 리마인더 — 「${contract.title}」 ${days}일째 대기 중\n${appUrl}${approvalPageUrl(step.approver?.role)}`;
        await hrBotSendDM(step.approverId, msg);
      }

      // 작성자 지연 현황 DM (스텝별 1건) — 작성자 본인이 담당자면 생략
      if (contract.createdBy && contract.createdBy !== step.approverId) {
        const who = step.approverId
          ? `${ROLE_LABEL[step.approver?.role || ""] || "결재자"} ${step.approver?.name || ""}`.trim()
          : `외부 ${step.externalName || contract.externalName || "계약자"}`;
        const verb = step.approverId && !isEmployeeStep ? "미결재" : "미서명";
        if (!creatorRoles.has(contract.createdBy)) {
          const creator = await prisma.user.findUnique({ where: { id: contract.createdBy }, select: { role: true } });
          creatorRoles.set(contract.createdBy, creator?.role ?? null);
        }
        await hrBotSendDM(
          contract.createdBy,
          `⏳ 결재 지연 — 「${contract.title}」\n${who} ${verb} ${days}일째\n확인: ${appUrl}${contractPageLink(creatorRoles.get(contract.createdBy))}`
        );
      }

      await prisma.contractApprovalStep.update({
        where: { id: step.id },
        data: { remindedAt: now },
      });
      sentCount++;
    } catch (e) {
      console.error("[contract] 리마인더 발송 오류:", step.id, e);
    }
  }
  if (sentCount) console.log(`[bot] 전자계약 리마인더 ${sentCount}건 발송`);
}
