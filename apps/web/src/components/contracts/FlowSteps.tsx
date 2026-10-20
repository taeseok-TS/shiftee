// 계약서 보내기 단계 표시 — 「1 서류 고르기 — 2 내용 입력 — 3 결재자·발송」(2026-10-20 시안 v2 1번)
// 지금 단계는 인디고로 채우고, 끝난 단계는 ✓. 끝난 단계를 누르면 그 단계로 돌아간다(onGo 가 있을 때만).
import { cn } from "@/lib/utils";

const LABELS = ["서류 고르기", "내용 입력", "결재자·발송"] as const;

export default function FlowSteps({ step, onGo }: { step: 1 | 2 | 3; onGo?: (s: 1 | 2) => void }) {
  return (
    <ol className="flex items-center gap-1.5 shrink-0" aria-label="보내기 단계">
      {LABELS.map((label, i) => {
        const n = (i + 1) as 1 | 2 | 3;
        const done = n < step, now = n === step;
        const canGo = done && !!onGo && n < 3;
        return (
          <li key={label} className="flex items-center gap-1.5">
            {i > 0 && <span className={cn("h-px w-5 sm:w-8", done || now ? "bg-indigo-300" : "bg-gray-200")} aria-hidden />}
            <button type="button" disabled={!canGo} onClick={() => canGo && onGo!(n as 1 | 2)} aria-current={now ? "step" : undefined}
              className={cn("rounded-full px-3 sm:px-4 py-2 text-sm font-bold whitespace-nowrap border transition-colors",
                now ? "bg-indigo-600 text-white border-indigo-600"
                  : done ? "bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100"
                  : "bg-white text-gray-500 border-gray-200",
                !canGo && !now && "cursor-default")}>
              {done ? "✓ " : `${n} `}{label}
            </button>
          </li>
        );
      })}
    </ol>
  );
}
