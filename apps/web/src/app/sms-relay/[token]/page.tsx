import { prisma } from "@/lib/db";
import SmsRelayClient from "./relay-client";

// 채팅·메일 어디서든 눌리는 https 링크 → 문자 앱으로 넘겨주는 중계 페이지.
// 앱 채팅은 https 링크만 탭이 되므로(sms: 스킴은 안 눌림) 이 한 단계가 필요하다.
// 토큰은 게스트 서명 링크와 같은 값 — 이 페이지가 새로 노출하는 비밀은 없다.
export default async function SmsRelayPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const step = await prisma.contractApprovalStep.findUnique({
    where: { signToken: token },
    select: {
      status: true,
      tokenExpiresAt: true,
      approvalLine: {
        select: {
          contract: { select: { title: true, externalName: true, externalPhone: true } },
        },
      },
    },
  });

  const contract = step?.approvalLine?.contract;
  const expired = !!step?.tokenExpiresAt && step.tokenExpiresAt < new Date();

  if (!step || !contract || expired) {
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
      signUrl={`/sign/${token}`}
      signed={step.status === "APPROVED"}
    />
  );
}
