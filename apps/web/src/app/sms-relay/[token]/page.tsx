import { prisma } from "@/lib/db";
import SmsRelayClient from "./relay-client";
import { parseRelayToken, checkRelayToken } from "@/lib/external-verify";

// 채팅·메일 어디서든 눌리는 https 링크 → 문자 앱으로 넘겨주는 중계 페이지.
// 앱 채팅은 https 링크만 탭이 되므로(sms: 스킴은 안 눌림) 이 한 단계가 필요하다.
// ⚠ 이 페이지는 외부 계약자 **번호 전체**를 다룬다. 그래서 서명 링크 토큰이 아니라 **전용 표식**
//   (lib/external-verify relayToken — 단계 id + HMAC(단계 id·현재 서명 토큰))으로만 열린다. 종전에는 서명 링크와
//   같은 토큰이라 서명 링크를 받은 사람이 경로만 바꿔 번호를 보고 본인 확인(뒷자리 4자리)을 통과할 수 있었다(#205 검증 A1).
export default async function SmsRelayPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const parsed = parseRelayToken(token);

  const step = parsed
    ? await prisma.contractApprovalStep.findUnique({
        where: { id: parsed.stepId },
        select: {
          status: true,
          tokenExpiresAt: true,
          signToken: true,
          approverId: true,
          approvalLine: {
            select: {
              contract: { select: { title: true, externalName: true, externalPhone: true } },
            },
          },
        },
      })
    : null;

  // 외부 서명 단계이고, 표식이 **지금의** 서명 토큰으로 만든 것일 때만(재발송·초기화로 토큰이 바뀌면 무효)
  const valid = !!parsed && !!step && !step.approverId && checkRelayToken(parsed.sig, parsed.stepId, step.signToken);
  const contract = valid ? step!.approvalLine?.contract : null;
  const expired = !!step?.tokenExpiresAt && step.tokenExpiresAt < new Date();

  if (!valid || !step || !contract || expired) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
        <div className="text-center space-y-2">
          <p className="text-lg font-semibold text-gray-800">유효하지 않은 링크입니다</p>
          <p className="text-sm text-gray-500">계약이 재발송되었거나 링크가 만료되었습니다. 관리자 화면에서 새 링크를 확인하세요.</p>
        </div>
      </div>
    );
  }

  return (
    <SmsRelayClient
      phone={contract.externalPhone || ""}
      name={contract.externalName || "계약자"}
      title={contract.title}
      signUrl={`/sign/${step.signToken}`}
      signed={step.status === "APPROVED"}
    />
  );
}
