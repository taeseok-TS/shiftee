import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { isDirectHost } from "@/lib/is-direct-host";
import LogoutAndLogin from "./LogoutAndLogin";
import Arrival from "./Arrival";

// 이메일 서명·결재 안내 링크의 본인 확인 관문 (#140, 2026-08-27)
//
// 배경: 메일의 "계약서 확인하기"가 그냥 /contracts 로 갔더니, 브라우저에 남아 있던
// 다른 사람(관리자) 세션으로 열렸다. 한 PC 를 여러 명이 쓰는 지점에서는 남의 계정으로
// 서명될 수 있다 (이예지대리 QA). 이제 링크에 수신자를 실어 보내고 여기서 대조한다.
export default async function ContractOpenPage({
  params,
  searchParams,
}: {
  params: Promise<{ uid: string }>;
  searchParams: Promise<{ for?: string }>;
}) {
  const { uid } = await params;
  const forSign = (await searchParams).for === "sign";   // 서명 요청 메일만 — 결재 요청·완료 메일은 종전처럼 계약서 화면으로(검증)
  const session = await getSession();

  // 미로그인 → 로그인 화면, 로그인하면 이 링크로 돌아온다
  if (!session) redirect(`/login?next=${encodeURIComponent(`/contract-open/${uid}${forSign ? "?for=sign" : ""}`)}`);

  // 본인이면 「계약서가 도착했어요」 첫 화면(시안 v2 5번) — 지금 내 서명 차례인 서류만. 없으면 계약서 화면으로
  if (session.userId === uid && !forSign) redirect("/contracts");
  if (session.userId === uid) {
    const pending = await prisma.contract.findMany({
      where: {
        userId: uid, externalName: null, status: { in: ["SENT", "APPROVED"] },
        approvalLine: { steps: { some: { approverId: uid, status: "PENDING" } } },
      },
      select: { id: true, title: true, signDeadline: true, createdBy: true, createdAt: true },
      orderBy: [{ signDeadline: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
      take: 20,
    });
    if (!pending.length) redirect("/contracts");
    const senderId = pending.find((c) => c.createdBy)?.createdBy;
    const sender = senderId ? await prisma.user.findUnique({ where: { id: senderId }, select: { name: true, role: true, branch: true } }) : null;
    const deadline = pending.map((c) => c.signDeadline).filter((d): d is Date => !!d).sort((a, b) => a.getTime() - b.getTime())[0];
    const host = (await headers()).get("host") || "";
    return (
      <Arrival
        org={isDirectHost(host) ? "에듀플렉스 직영" : "전자계약"}
        name={session.name}
        items={pending.map((c) => ({ id: c.id, title: c.title }))}
        sender={!sender?.name ? "본부" : sender.role === "MANAGER" ? `${sender.branch ? `${sender.branch} ` : ""}원장 ${sender.name}` : `본부 ${sender.name}`}
        deadline={deadline ? deadline.toISOString() : null}
      />
    );
  }

  // 다른 계정으로 로그인된 상태 — 누구 앞으로 온 링크인지 알려주고 전환을 유도
  const target = await prisma.user.findUnique({
    where: { id: uid },
    select: { name: true },
  });

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white border rounded-xl shadow-sm max-w-md w-full p-6 space-y-4">
        <div className="space-y-1">
          <p className="text-xs text-gray-400">큐브티 전자계약</p>
          <h1 className="text-lg font-bold">다른 계정으로 로그인되어 있습니다</h1>
        </div>
        <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800 space-y-1">
          <p>
            이 링크는 <b>{target?.name || "다른 직원"}</b>님 앞으로 발송된 서명 안내입니다.
          </p>
          <p>
            현재 브라우저는 <b>{session.name}</b>님으로 로그인되어 있습니다.
          </p>
        </div>
        <p className="text-xs text-gray-500">
          본인 계정으로 로그인해야 서명할 수 있습니다. 아래 버튼을 누르면 로그아웃 후
          로그인 화면으로 이동합니다.
        </p>
        <LogoutAndLogin />
      </div>
    </div>
  );
}
