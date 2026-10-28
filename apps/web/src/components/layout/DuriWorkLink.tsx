"use client";
// 레일 맨 아래 「큐브티워크」(2026-10-21 본부 시안 듀리 아이콘 ①) — 구분선 + 듀리 얼굴 26px + 「큐브티워크」 11px + 안 읽은 수(빨간 16px 알약).
// 누르면 메신저(/work/chat). 안 읽은 수는 상단 바 버튼과 같은 API(useWorkUnread → /api/work/unread).
import Image from "next/image";
import { useWorkUnread } from "./WorkUnreadBadge";

export function DuriWorkLink() {
  const count = useWorkUnread();
  return (
    <a href="/work/chat" className="mt-auto flex w-[64px] flex-col items-center gap-0.5 border-t border-slate-700 pt-3 text-[12px] font-medium text-slate-300 hover:text-white" title="큐브티워크">
      <span className="relative">
        <Image src="/icons/duri-face-64.png" alt="" width={26} height={26} className="h-[26px] w-[26px]" />
        {count > 0 && (
          <span className="absolute -right-2.5 -top-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold leading-none text-white ring-2 ring-slate-900" aria-label={`안 읽은 메시지 ${count}개`}>
            {count > 99 ? "99+" : count}
          </span>
        )}
      </span>
      큐브티워크
    </a>
  );
}
