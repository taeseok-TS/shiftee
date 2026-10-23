"use client";
// 대시보드 박스 둘 — 결재함 · 공지사항(본부 시안 R9 · R16 · R17 「세 대시보드 같은 모양」).
// 관리자(R9) · 원장(R16) · 직원(R17) 대시보드가 같이 쓴다. 숫자 칸 박스는 화면마다 달라 각 화면이 kit Tiles 로 그린다
import { useEffect, useState, type ReactNode } from "react";
import { format } from "date-fns";
import { CheckSquare, Megaphone, Pin } from "lucide-react";
import { Box } from "@/components/kit";

/** 결재함 한 줄 — 제목 + 회색 한 줄 + 오른쪽 「열기 ›」(action 으로 「서명 ›」 · 「보기 ›」) */
export type InboxRow = { key: string; title: string; sub: string; href?: string; onOpen?: () => void; alert?: boolean; muted?: boolean; action?: string; at: number };

export function InboxBox({ rows, count, loading, allHref, more, moreHref, empty = "처리할 요청 없음" }: {
  rows: InboxRow[]; count?: number; loading: boolean; allHref?: string; more?: number; moreHref?: string; empty?: string;
}) {
  return (
    <Box icon={<CheckSquare />} tone="rose" title="결재함" count={count ?? rows.length} className="!mb-0 min-w-0"
      right={allHref ? <a href={allHref} className="text-[#4f46e5] hover:underline">전체 보기 ›</a> : undefined}>
      <div className="px-6 py-1">
        {loading && !rows.length ? (
          <p className="py-5 text-[14px] text-[#596578]">불러오는 중…</p>
        ) : !rows.length ? (
          <p className="py-5 text-[14px] text-[#596578]">{empty}</p>
        ) : rows.map((r) => {
          const body = (
            <>
              <span className="min-w-0 flex-1">
                <b className={`block truncate text-[16px] font-bold ${r.alert ? "text-[#dc2626]" : r.muted ? "text-[#596578]" : "text-[#0f172a]"}`}>{r.title}</b>
                <span className="block truncate text-[13.5px] text-[#596578]">{r.sub}</span>
              </span>
              <span className="shrink-0 text-[14.5px] font-semibold text-[#4f46e5]">{r.action ?? "열기"} ›</span>
            </>
          );
          const cls = "flex w-full items-center gap-3.5 border-t border-[#f1f5f9] py-[15px] text-left first:border-t-0 hover:bg-[#fafbfd]";
          return r.href
            ? <a key={r.key} href={r.href} className={cls}>{body}</a>
            : <button key={r.key} type="button" onClick={r.onOpen} className={cls}>{body}</button>;
        })}
        {!!more && more > 0 && moreHref && <a href={moreHref} className="block border-t border-[#f1f5f9] py-3 text-center text-[13.5px] font-semibold text-[#4f46e5] hover:underline">{more}건 더 보기 ›</a>}
      </div>
    </Box>
  );
}

export type Notice = { id: string; title: string; content: string; pinned: boolean; authorName: string; createdAt: string };

/** 공지사항 — 제목 · 작성자 · 날짜, 누르면 펼침. right = 관리자 「＋ 작성」(원장 · 직원은 읽기만) */
export function NoticeBox({ items, right }: { items: Notice[]; right?: ReactNode }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <Box icon={<Megaphone />} tone="amb" title="공지사항" className="!mb-0 min-w-0" right={right}>
      <div className="px-6 py-1">
        {items.length === 0 ? (
          <p className="py-5 text-[14px] text-[#596578]">등록된 공지가 없습니다.</p>
        ) : items.map((n) => (
          <div key={n.id} className="border-t border-[#f1f5f9] first:border-t-0">
            <button type="button" onClick={() => setOpen(open === n.id ? null : n.id)} aria-expanded={open === n.id}
              className="flex w-full items-center gap-3.5 py-[15px] text-left">
              <span className="min-w-0 flex-1">
                <b className="flex items-center gap-1.5 truncate text-[16px] font-bold text-[#0f172a]">{n.pinned && <Pin size={14} className="shrink-0 text-[#4f46e5]" aria-label="고정" />}{n.title}</b>
                <span className="block truncate text-[13.5px] text-[#596578]">{n.authorName}</span>
              </span>
              <span className="shrink-0 text-[13.5px] text-[#596578]">{format(new Date(n.createdAt), "M월 d일")}</span>
            </button>
            {open === n.id && (
              <div className="pb-4">
                <p className="whitespace-pre-wrap text-[14px] text-[#334155]">{n.content}</p>
                <a href="/work/announcements" className="mt-2 inline-block text-[13px] font-semibold text-[#4f46e5] hover:underline">큐브티워크에서 보기 ›</a>
              </div>
            )}
          </div>
        ))}
      </div>
    </Box>
  );
}

/** 공지 5건 — 큐브티워크 공지와 같은 자료. reloadKey 가 바뀌면 다시 읽는다 */
export function useNotices(reloadKey = 0): Notice[] {
  const [items, setItems] = useState<Notice[]>([]);
  useEffect(() => {
    let alive = true;
    fetch("/api/work/announcements").then((r) => (r.ok ? r.json() : null)).then((d) => { if (alive && d) setItems((d.announcements || []).slice(0, 5)); }).catch(() => {});
    return () => { alive = false; };
  }, [reloadKey]);
  return items;
}

/** 결재함 줄의 날짜 — @db.Date(UTC 자정) 두 날짜를 「10/26 ~ 30」 · 「10/23」 */
export function periodLabel(start: string, end: string): string {
  const s = start.slice(0, 10), e = end.slice(0, 10);
  const md = (v: string) => `${Number(v.slice(5, 7))}/${Number(v.slice(8, 10))}`;
  if (s === e) return md(s);
  return s.slice(0, 7) === e.slice(0, 7) ? `${md(s)} ~ ${Number(e.slice(8, 10))}` : `${md(s)} ~ ${md(e)}`;
}
