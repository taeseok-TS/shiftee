import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import LogoutAndLogin from "./LogoutAndLogin";

// 이메일 서명·결재 안내 링크의 본인 확인 관문 (#140, 2026-08-27)
//
// 배경: 메일의 "계약서 확인하기"가 그냥 /contracts 로 갔더니, 브라우저에 남아 있던
// 다른 사람(관리자) 세션으로 열렸다. 한 PC 를 여러 명이 쓰는 지점에서는 남의 계정으로
// 서명될 수 있다 (이예지대리 QA). 이제 링크에 수신자를 실어 보내고 여기서 대조한다.
export default async function ContractOpenPage({
  params,
}: {
  params: Promise<{ uid: string }>;
}) {
  const { uid } = await params;
  const session = await getSession();

  // 미로그인 → 로그인 화면 (로그인 후 이 링크를 다시 누르면 통과)
  if (!session) redirect("/login");

  // 본인이면 바로 계약서 화면으로
  if (session.userId === uid) redirect("/contracts");

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
