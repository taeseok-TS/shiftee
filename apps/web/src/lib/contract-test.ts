import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { recordContractEvent } from "@/lib/contract-events";
import { hrBotSendDM } from "@/lib/bot";
import { getAppUrl } from "@/lib/app-url";
import { sendContractNotification } from "@/lib/email";
import { deadlineFromDays } from "@/lib/contract-deadline";
import { messageDmLine, readDefaultSendMessage } from "@/lib/contract-send-meta";

// ─── 나에게 테스트 발송(2026-10-08 QA76 #67) ─────────────────────────────
// 실제로 보내기 전에 관리자 본인에게 먼저 보내, 서명자가 받는 그대로(메일·봇 DM·비밀번호 관문·입력 칸·완료본)를 본다.
//  · 서명자 = 작성 관리자 본인. 결재선은 본인 서명 한 단계 — 다른 사람에게는 아무 알림도 가지 않는다
//  · isTest 문서는 관리자 목록(기본)·원장 목록·결재함·내보내기·중복 발송 검사·리마인더·만료 본부 알림에서 빠진다
//    본인 「내 계약서」에는 보인다(서명자 화면이 목적). 관리자 목록은 「내 테스트 문서만」을 켜면 자기 것만 보인다
//  · 제목에 TEST_TITLE_PREFIX 를 붙여 문서·메일·DM 어디서든 시험 문서임이 보이게 한다
//  · TEST_RETENTION_DAYS 가 지나면 매일 10시 점검에서 지운다(본부 답 없음 — 큐브 기본값, 디렉터 확인 사항).
//    파일은 두고 행만 지운다(기존 계약 삭제와 같은 방식). 완료(SIGNED)된 시험 문서도 관리자가 바로 지울 수 있다
export const TEST_TITLE_PREFIX = "[테스트] ";
export const TEST_DEADLINE_DAYS = 7;
export const TEST_RETENTION_DAYS = 7;

/** 시험 문서를 보낸다 — 결재선(본인 1단계)·SENT·기한·양식 버전·발송 메시지(본부 기본 문구)·감사 기록·본인 알림 */
export async function sendTestContract(contractId: string, actor: { userId: string; name: string }, request?: Request | null) {
  const contract = await prisma.contract.findUnique({
    where: { id: contractId },
    select: { id: true, title: true, isTest: true, status: true, userId: true, templateId: true, user: { select: { email: true, name: true } } },
  });
  if (!contract || !contract.isTest || contract.userId !== actor.userId || contract.status !== "DRAFT") throw new Error("TEST_CONTRACT_INVALID");
  const tmpl = contract.templateId ? await prisma.contractTemplate.findUnique({ where: { id: contract.templateId }, select: { version: true } }) : null;
  // 발송 메시지는 본부 기본 문구 — 직원이 받는 것과 같아야 시험이 된다
  const sendMessage = (await readDefaultSendMessage().catch(() => "")).trim() || null;
  const signDeadline = deadlineFromDays(TEST_DEADLINE_DAYS);
  await prisma.$transaction([
    prisma.contractApprovalLine.create({ data: { contractId, steps: { create: [{ approverId: actor.userId, order: 1, status: "PENDING" }] } } }),
    prisma.contract.update({ where: { id: contractId }, data: { status: "SENT", signDeadline, templateVersion: tmpl?.version ?? null, sendMessage } }),
  ]);
  await recordContractEvent({ contractId, type: "SENT", actorId: actor.userId, actorName: actor.name, request, meta: { test: true, templateVersion: tmpl?.version ?? null } });
  await logAudit({ actorId: actor.userId, actorName: actor.name, action: "CONTRACT_TEST_SEND", targetType: "Contract", targetId: contractId, targetName: actor.name, detail: `「${contract.title}」 나에게 테스트 발송(${TEST_RETENTION_DAYS}일 뒤 자동 삭제)` });

  // 본인 알림 — 실제 서명자가 받는 것과 같은 문구(메일·봇 DM). 실패해도 발송은 된 것
  const appUrl = getAppUrl();
  if (contract.user.email) {
    await sendContractNotification(contract.user.email, contract.user.name, contract.title, appUrl, actor.userId, sendMessage)
      .catch((e) => console.error("[contract] 테스트 발송 메일 오류:", e));
  }
  hrBotSendDM(actor.userId, `📝 전자계약 서명 요청\n「${contract.title}」\n앱 [더보기] → [계약서]에서 내용 확인 후 서명해 주세요.\n웹에서 바로 서명: ${appUrl}/contracts` + messageDmLine(sendMessage))
    .catch((e) => console.error("[contract] 테스트 발송 DM 오류:", e));
  return { signDeadline, sendMessage };
}

/** 보관 기간이 지난 시험 문서를 지운다(결재선·버전·기록은 FK cascade). 매일 10시 리마인더 점검에서 부른다 */
export async function purgeTestContracts(): Promise<number> {
  const cutoff = new Date(Date.now() - TEST_RETENTION_DAYS * 86400000);
  const olds = await prisma.contract.findMany({
    where: { isTest: true, createdAt: { lt: cutoff } },
    select: { id: true, title: true, user: { select: { name: true } } },
    take: 200,
  });
  if (!olds.length) return 0;
  const r = await prisma.contract.deleteMany({ where: { id: { in: olds.map((c) => c.id) }, isTest: true } });
  await logAudit({
    actorId: "cubetee-bot", actorName: "큐브티 봇", action: "CONTRACT_TEST_PURGE", targetType: "Contract",
    detail: `${TEST_RETENTION_DAYS}일 지난 테스트 문서 ${r.count}건 삭제 — ${olds.slice(0, 10).map((c) => `${c.user.name} 「${c.title}」`).join(", ")}${olds.length > 10 ? ` 외 ${olds.length - 10}건` : ""}`,
  });
  return r.count;
}
