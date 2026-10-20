// 계약서를 받았을 때 맨 처음 보는 화면(2026-10-20 본부 박정인 시안 v2 5번, 첨부 4-0).
// 글씨는 줄이고 「무슨 서류가 왔는지」와 「본인 확인」만 — 직원(/contract-open)과 외부 계약자(/sign/[token])가 같은 틀을 쓴다.
// 본인 확인 칸·버튼은 children 으로 받는다(직원 = 로그인 비밀번호, 외부 = 연락처 뒷자리·이메일).
import type { ReactNode } from "react";

/** 제목으로 부르는 이름 — 「근로계약서가 도착했어요」 / 여러 건이면 「서류 3건이 도착했어요」 */
export function arrivalHeading(titles: string[]): string {
  if (titles.length > 1) return `서류 ${titles.length}건이 도착했어요`;
  const t = titles[0] || "";
  const kind = t.includes("근로계약서") ? "근로계약서" : t.includes("계약서") ? "계약서" : t.includes("동의서") ? "동의서" : "서류";
  return `${kind}가 도착했어요`;
}

/** 서명 기한 — 「10/27 (7일 남음)」(한국 날짜 기준) */
export function deadlineLabel(iso: string | null | undefined, nowMs: number): string | null {
  if (!iso) return null;
  const end = new Date(iso).getTime();
  if (!Number.isFinite(end)) return null;
  const kstDay = (ms: number) => Math.floor((ms + 9 * 3600_000) / 86400_000);
  const k = new Date(end + 9 * 3600_000);
  const md = `${k.getUTCMonth() + 1}/${k.getUTCDate()}`;
  const left = kstDay(end) - kstDay(nowMs);
  return `${md} (${left > 0 ? `${left}일 남음` : left === 0 ? "오늘까지" : "기한 지남"})`;
}

export function ArrivalCard({ org, heading, greeting, titles, sender, deadline, children, footnote }: {
  org: string;                    // 머리글 아래 작은 줄(예: 「에듀플렉스 직영」)
  heading: string;
  greeting: string;               // 「김가산 님, 아래 서류를 확인하고 서명해 주세요.」
  titles: string[];
  sender: string | null;          // 보낸 곳(본부 담당자)
  deadline: string | null;        // deadlineLabel 결과
  children: ReactNode;            // 본인 확인 칸·버튼
  footnote?: ReactNode;           // 버튼 아래 한 줄
}) {
  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl border bg-white p-6 sm:p-8 shadow-sm space-y-5">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-600 text-sm font-bold text-white" aria-hidden>A</span>
          <div className="leading-tight">
            <p className="text-sm font-bold text-gray-900">큐브티 전자계약</p>
            <p className="text-xs text-gray-500">{org}</p>
          </div>
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{heading}</h1>
          <p className="mt-1 text-sm text-gray-600">{greeting}</p>
        </div>
        <div className="flex gap-3 rounded-xl border bg-slate-50 p-4">
          <div className="hidden sm:flex h-14 w-10 shrink-0 flex-col justify-center gap-1 rounded border bg-white px-1.5" aria-hidden>
            {[0, 1, 2, 3, 4].map((i) => <span key={i} className="h-px bg-gray-200" />)}
          </div>
          <div className="min-w-0 flex-1 space-y-1.5 text-sm">
            {titles.map((t, i) => <p key={i} className="font-semibold text-gray-900 break-keep">{t}</p>)}
            {sender && <p className="flex justify-between gap-3 text-gray-500">보낸 곳 <b className="text-gray-900 text-right">{sender}</b></p>}
            {deadline && <p className="flex justify-between gap-3 text-gray-500">서명 기한 <b className="text-gray-900 text-right">{deadline}</b></p>}
          </div>
        </div>
        <div className="space-y-2">
          <h2 className="border-b pb-2 text-lg font-bold text-gray-900">본인 확인</h2>
          {children}
        </div>
        {footnote}
        <p className="text-center text-xs text-gray-500">🔒 서명한 시각·기기가 기록되고, 끝나면 체결본을 받아 볼 수 있어요</p>
      </div>
    </div>
  );
}
