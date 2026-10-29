"use client";
// 화면 공통 부품 한 벌 — 본부 시안 R9(대시보드) 톤(2026-10-21 본부 이예지 「디자인 통일」 3장, 값은 시안_소스 n-style.css·common.css 그대로).
// 모든 관리자·원장·직원 화면이 이 부품을 쓴다 — 화면마다 따로 스타일을 쓰면 또 조금씩 달라진다(요청서 8장 「하지 말 것」).
//  · 색은 둘만 힘을 쓴다: 인디고 #4f46e5 = 누를 것 · 고른 것, 빨강 #dc2626 = 내가 처리할 것(건수 배지 · 알림 점). 근태 숫자(지각 · 결근 · 조퇴)는 회색 — 2026-10-29 이예지
//  · 초록·검정 채움 버튼·이모지·숫자 색칠·박스 왼쪽 색 띠는 쓰지 않는다
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { MoreVertical } from "lucide-react";
import { cn } from "@/lib/utils";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

/* ── 페이지 머리: 작은 경로 + 제목(= 패널 메뉴 이름) + 오른쪽 기준 시각·보조 버튼·실행 버튼 하나 ── */
export function PageHead({ crumb, title, note, children }: { crumb?: string; title: ReactNode; note?: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {crumb && <p className="text-xs text-[#596578]">{crumb}</p>}
        <h1 className="mt-0.5 text-[26px] font-bold leading-tight text-[#0f172a]">{title}</h1>
      </div>
      {(note || children) && (
        <div className="flex flex-wrap items-center gap-2">
          {note && <span className="text-[13px] text-[#596578]">{note}</span>}
          {children}
        </div>
      )}
    </div>
  );
}

/* ── 버튼: 실행(인디고 채움, 화면당 하나) · 보조(흰) · 글자(인디고 글자만) ── */
type BtnKind = "primary" | "secondary" | "text";
const BTN: Record<BtnKind, string> = {
  primary: "rounded-[10px] border border-[#4f46e5] bg-[#4f46e5] px-[15px] py-2 text-[13.5px] font-bold text-white hover:bg-[#4338ca] disabled:border-[#e2e8f0] disabled:bg-[#eef1f5] disabled:text-[#7c8798]",
  secondary: "rounded-[10px] border border-[#e2e8f0] bg-white px-[15px] py-2 text-[13.5px] font-medium text-[#0f172a] hover:bg-[#f8fafc] disabled:text-[#7c8798]",
  text: "px-1 text-[14px] font-semibold text-[#4f46e5] hover:underline disabled:text-[#94a3b8]",
};
export const btnClass = (kind: BtnKind = "secondary", extra?: string) => cn("inline-flex items-center justify-center gap-1.5 whitespace-nowrap transition-colors disabled:cursor-not-allowed", BTN[kind], extra);
export function Btn({ kind = "secondary", href, className, children, ...rest }: { kind?: BtnKind; href?: string } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  if (href) return <Link href={href} className={btnClass(kind, className)} title={rest.title} aria-label={rest["aria-label"]}>{children}</Link>;
  return <button type="button" className={btnClass(kind, className)} {...rest}>{children}</button>;
}

/* ── 알약 탭(한 화면에 한 줄만): 흰 바탕 + 회색 테두리, 고른 탭 인디고 채움. 건수 알약, 「결재 대기」류는 빨강 ── */
export type PillTab = { key: string; label: string; count?: number | null; hot?: boolean; href?: string };
export function PillTabs({ tabs, value, onChange, className }: { tabs: PillTab[]; value: string; onChange?: (key: string) => void; className?: string }) {
  return (
    <div className={cn("mb-[18px] flex flex-wrap gap-2", className)} role="tablist">
      {tabs.map((t) => {
        const on = t.key === value;
        const cls = cn("inline-flex items-center gap-1.5 rounded-full border px-4 py-[7px] text-[14px] font-semibold transition-colors",
          on ? "border-[#4f46e5] bg-[#4f46e5] text-white" : "border-[#e2e8f0] bg-white text-[#475569] hover:bg-[#f8fafc]");
        const badge = typeof t.count === "number" && t.count > 0 ? (
          <em className={cn("rounded-full px-[7px] text-[12px] not-italic leading-[19px]",
            // 처리할 건수(hot)는 빨강(2026-10-29 이예지 12:37 — 써 보니 파란 점이 눈에 안 들어온다: 처리할 건수 · 알림 점은 빨강, 근태 숫자는 중립 회색)
            t.hot ? "bg-[#dc2626] text-white" : on ? "bg-white/25 text-white" : "bg-[#f1f5f9] text-[#475569]")}>{t.count}</em>
        ) : null;
        return t.href
          ? <Link key={t.key} href={t.href} role="tab" aria-selected={on} className={cls}>{t.label}{badge}</Link>
          : <button key={t.key} type="button" role="tab" aria-selected={on} onClick={() => onChange?.(t.key)} className={cls}>{t.label}{badge}</button>;
      })}
    </div>
  );
}

/* ── 박스: 흰 바탕·1px 테두리·모서리 14px. 머리 = 파스텔 아이콘 + 제목 17.5px + (빨간 건수 알약) + 회색 설명 + 오른쪽 글자 버튼 ── */
export type Tone = "ind" | "rose" | "amb" | "sky" | "vio" | "sl";
const TONE: Record<Tone, string> = {
  ind: "bg-[#eef2ff] text-[#4f46e5]", rose: "bg-[#fff1f2] text-[#e11d48]", amb: "bg-[#fffbeb] text-[#b45309]",
  sky: "bg-[#f0f9ff] text-[#0369a1]", vio: "bg-[#f5f3ff] text-[#6d28d9]", sl: "bg-[#f1f5f9] text-[#475569]",
};
export function Box({ icon, tone = "ind", title, count, sub, right, children, className, bodyClassName }: {
  icon?: ReactNode; tone?: Tone; title?: ReactNode; count?: number | null; sub?: ReactNode; right?: ReactNode;
  children?: ReactNode; className?: string; bodyClassName?: string;
}) {
  return (
    <section className={cn("mb-[18px] rounded-[14px] border border-[#e2e8f0] bg-white shadow-[0_1px_3px_rgba(15,23,42,.05)]", className)}>
      {title && (
        <div className="flex flex-wrap items-center gap-2.5 border-b border-[#eef1f5] px-6 py-[17px]">
          {icon && <span className={cn("grid h-8 w-8 flex-none place-items-center rounded-[9px] [&_svg]:h-[18px] [&_svg]:w-[18px]", TONE[tone])}>{icon}</span>}
          <h2 className="text-[17.5px] font-bold text-[#0f172a]">{title}</h2>
          {typeof count === "number" && count > 0 && <em className="rounded-full bg-[#dc2626] px-2 text-[13px] not-italic leading-[21px] text-white">{count}</em>}
          {sub && <span className="text-[13px] text-[#596578]">{sub}</span>}
          {right && <div className="ml-auto flex items-center gap-2 text-[14px] font-semibold">{right}</div>}
        </div>
      )}
      {children !== undefined && <div className={bodyClassName}>{children}</div>}
    </section>
  );
}

/* ── 숫자 칸: 같은 크기로 한 줄(4~6칸). 숫자는 검정, 처리할 숫자가 1 이상일 때만 빨강(alert), 「전체」 성격은 연인디고(hl). 값을 모르면 「—」 ── */
export function Tiles({ cols, children, className }: { cols: number; children: ReactNode; className?: string }) {
  // 휴대폰은 두 칸씩. 4칸 이하는 중간 폭부터 한 줄, 5~6칸은 중간 폭(사이드바가 보이는 태블릿) 세 칸 → 넓은 화면(lg) 한 줄
  const wide = cols <= 4 ? "md:[grid-template-columns:repeat(var(--cols),minmax(0,1fr))]" : "md:grid-cols-3 lg:[grid-template-columns:repeat(var(--cols),minmax(0,1fr))]";
  return <div className={cn("grid grid-cols-2 gap-3 px-6 pb-[22px] pt-[18px]", wide, className)}
    style={{ ["--cols" as string]: cols } as React.CSSProperties}>{children}</div>;
}
export function Tile({ label, value, unit, note, alert = false, hl = false, active = false, onClick }: {
  label: string; value: number | string | null | undefined; unit?: string; note?: ReactNode; alert?: boolean; hl?: boolean; active?: boolean; onClick?: () => void;
}) {
  const shown = value === null || value === undefined || value === "" ? "—" : value;
  const red = alert && typeof value === "number" && value > 0;
  const body = (
    <>
      <span className="text-[14px] font-semibold text-[#475569]">{label}</span>
      <b className={cn("text-[34px] font-extrabold leading-[1.15] tabular-nums", red ? "text-[#dc2626]" : "text-[#0f172a]")}>
        {shown}{unit && shown !== "—" && <small className="ml-[3px] text-[14px] font-semibold text-[#596578]">{unit}</small>}
      </b>
      {/* 설명은 낱말 단위로 줄을 넘기고 두 줄 길이를 고르게 — 「…기록 없 / 음」처럼 한 글자만 넘어가지 않게(2026-10-28 이예지 ⑦) */}
      {note && <i className="break-keep text-[12px] not-italic text-[#596578] [text-wrap:balance]">{note}</i>}
    </>
  );
  const cls = cn("flex flex-col gap-0.5 rounded-xl border px-4 pb-[13px] pt-3.5 text-left",
    hl ? "border-[#dfe5ff] bg-[#eef2ff]" : "border-[#eef1f5] bg-[#f8fafc]",
    active && "ring-2 ring-[#4f46e5]/40", onClick && "hover:border-[#c7d2fe]");
  return onClick ? <button type="button" onClick={onClick} aria-pressed={active} className={cls}>{body}</button> : <div className={cls}>{body}</div>;
}

/* ── 표: 박스 안. 위 필터 줄, 머리 13px 굵게 회색(#fafbfd), 줄 14px·위아래 14px·좌우 24px. 첫 칸 = 이름 굵게 + 아래 12.5px 회색 ── */
export function FilterRow({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2.5 border-b border-[#eef1f5] px-6 py-4">
      {children}
      {right && <div className="ml-auto flex flex-wrap gap-1.5">{right}</div>}
    </div>
  );
}
export const inputClass = "rounded-[10px] border border-[#e2e8f0] bg-white px-3 py-2 text-[13.5px] text-[#334155] outline-none focus:border-[#c7d2fe] focus:ring-2 focus:ring-[#eef2ff]";
/** 고르기 칸(select) — 화살표를 브라우저 기본 대신 같은 모양 하나로, 높이 · 테두리 · 글씨는 inputClass 와 같게(2026-10-28 이예지 디자인 ⑥) */
export const selectClass = `${inputClass} kit-select`;   // 화살표 · 높이는 globals.css .kit-select
/** 날짜 칸 — 다른 입력 칸과 같은 높이 · 테두리 · 글씨, 비어 있으면 「날짜 고르기」(브라우저 기본 「연도-월-일」 대신 — 이예지 디자인 ⑥).
 *  비어 있을 때는 글자 칸으로 보이다가 누르면 날짜 칸으로 바뀌어 달력이 열린다 */
export function DateInput({ value, onChange, placeholder = "날짜 고르기", className, ...rest }: Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "onChange"> & { value: string; onChange: (v: string) => void }) {
  const [focused, setFocused] = useState(false);
  const asText = !value && !focused;
  return (
    <input {...rest} type={asText ? "text" : "date"} max={rest.max ?? "9999-12-31"} value={value} placeholder={placeholder}
      onFocus={(e) => { setFocused(true); const el = e.currentTarget; window.setTimeout(() => { try { el.showPicker?.(); } catch { /* 지원하지 않는 브라우저 */ } }, 0); }}
      onBlur={() => setFocused(false)} onChange={(e) => onChange(e.target.value)}
      className={cn(inputClass, "h-[38px] w-[150px] placeholder:text-[#94a3b8]", className)} />
  );
}
export const tableClass = "w-full border-collapse text-[14px] [&_th]:border-b [&_th]:border-[#eef1f5] [&_th]:bg-[#fafbfd] [&_th]:px-6 [&_th]:pb-2.5 [&_th]:pt-3 [&_th:not(.text-right):not(.text-center)]:text-left [&_th]:text-[13px] [&_th]:font-semibold [&_th]:text-[#596578] [&_td]:border-b [&_td]:border-[#f1f5f9] [&_td]:px-6 [&_td]:py-3.5 [&_td]:align-middle [&_tr:last-child_td]:border-b-0";
export function Cell2({ main, sub }: { main: ReactNode; sub?: ReactNode }) {
  return <><b className="font-bold text-[#0f172a]">{main}</b>{sub && <span className="block text-[12.5px] text-[#596578]">{sub}</span>}</>;
}
export function Chip({ on = false, children, onClick }: { on?: boolean; children: ReactNode; onClick?: () => void }) {
  return <button type="button" onClick={onClick} aria-pressed={on} className={cn("rounded-full border px-3 py-[5px] text-[13px] font-semibold",
    on ? "border-[#4f46e5] bg-[#4f46e5] text-white" : "border-[#cbd5e1] bg-white text-[#475569] hover:bg-[#f8fafc]")}>{children}</button>;   // 켜짐 = 채운 인디고, 꺼짐 = 테두리만(이예지 10/28 디자인 ③)
}

/* ── 상태 알약: 대기 주황 · 완료 파랑 · 반려 분홍 · 취소·기타 회색 · 계약 연인디고 ── */
export type PillTone = "wait" | "done" | "rej" | "gray" | "ind";
const PILL: Record<PillTone, string> = {
  wait: "bg-[#fffbeb] text-[#b45309]", done: "bg-[#eff6ff] text-[#1d4ed8]", rej: "bg-[#fff1f2] text-[#be123c]", gray: "bg-[#f1f5f9] text-[#475569]", ind: "bg-[#eef2ff] text-[#4f46e5]",
};
export function StatusPill({ tone, children }: { tone: PillTone; children: ReactNode }) {
  return <span className={cn("inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-[12.5px] font-bold", PILL[tone])}>{children}</span>;
}

/* ── 작은 표시 알약(둘째 줄 보조 표시용): 회색 글자 · 1px 테두리 · 11.5px. href 를 주면 링크(새 창) ── */
export function MiniPill({ children, title, href, className }: { children: ReactNode; title?: string; href?: string; className?: string }) {
  const cls = cn("inline-block whitespace-nowrap rounded-full border border-[#e2e8f0] bg-[#f8fafc] px-1.5 text-[12px] font-semibold leading-[18px] text-[#596578] align-middle", href && "hover:border-[#c7d2fe] hover:text-[#4f46e5]", className);
  return href
    ? <a href={href} target="_blank" rel="noreferrer" title={title} className={cls}>{children}</a>
    : <span title={title} className={cls}>{children}</span>;
}

/* ── 결재 진행: 사람마다 점 + 이름. 끝남 인디고 채움 ✓ · 지금 차례 인디고 테두리 · 아직 회색(2026-10-28 이예지 디자인 ⑤) */
export type FlowStep = { label: string; state: "done" | "now" | "todo" };
export function FlowDots({ steps }: { steps: FlowStep[] }) {
  return (
    <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[13px] text-[#475569]">
      {steps.map((s, i) => (
        <span key={i} className="inline-flex items-center gap-1.5">
          {/* 끝남 = 인디고 채움 + ✓ · 지금 차례 = 인디고 테두리 · 아직 = 회색(점 색이 비슷해 구분이 안 됐다 — 2026-10-28 이예지 디자인 ⑤) */}
          <i className={cn("inline-grid h-[14px] w-[14px] place-items-center rounded-full text-[9px] font-bold not-italic leading-none text-white",
            s.state === "done" ? "bg-[#4f46e5]" : s.state === "now" ? "border-2 border-[#4f46e5] bg-white" : "bg-[#cbd5e1]")} aria-label={s.state === "done" ? "끝남" : s.state === "now" ? "지금 차례" : "남음"}>{s.state === "done" ? "✓" : null}</i>
          <span className={s.state === "now" ? "font-semibold text-[#4f46e5]" : s.state === "todo" ? "text-[#94a3b8]" : undefined}>{s.label}</span>
        </span>
      ))}
    </span>
  );
}

/* ── 줄 끝 더보기(⋮): 수정 · 재발송 · 이력 · 숨기기 · 삭제(맨 아래 빨간 글씨, 누르면 한 번 더 확인은 부르는 쪽이) ── */
export type MoreItem = { label: string; onClick: () => void; danger?: boolean; hidden?: boolean };
export function MoreMenu({ items, label = "더 보기", big = false }: { items: MoreItem[]; label?: string; big?: boolean }) {
  const shown = items.filter((i) => !i.hidden);
  if (!shown.length) return null;
  const safe = shown.filter((i) => !i.danger), danger = shown.filter((i) => i.danger);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={`inline-flex items-center justify-center rounded-md text-[#94a3b8] hover:bg-[#f1f5f9] hover:text-[#475569] ${big ? "h-11 w-11" : "h-8 w-7"}`} aria-label={label}>
        <MoreVertical size={17} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        {safe.map((i) => <DropdownMenuItem key={i.label} onClick={i.onClick}>{i.label}</DropdownMenuItem>)}
        {danger.length > 0 && safe.length > 0 && <DropdownMenuSeparator />}
        {danger.map((i) => <DropdownMenuItem key={i.label} onClick={i.onClick} className="text-[#dc2626]">{i.label}</DropdownMenuItem>)}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/* ── 스위치(권한·설정): 40×23, 켬 = 인디고. 왼쪽에 지금 상태 글자 ── */
export function Toggle({ on, onChange, disabled, label }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean; label?: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className={cn("w-6 text-[13px] font-bold", on ? "text-[#4f46e5]" : "text-[#94a3b8]")}>{on ? "켬" : "끔"}</span>
      <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)}
        className={cn("relative h-[23px] w-10 flex-none rounded-full transition-colors disabled:opacity-50", on ? "bg-[#4f46e5]" : "bg-[#cbd5e1]")}>
        <span className={cn("absolute top-[3px] h-[17px] w-[17px] rounded-full bg-white shadow transition-all", on ? "left-5" : "left-[3px]")} />
      </button>
    </span>
  );
}

/* ── 목록 줄(대시보드 결재함·공지): 제목 16px 굵게 + 아래 13.5px 회색 + 오른쪽 「열기 ›」 ── */
export function ListRow({ title, sub, right }: { title: ReactNode; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-center gap-3.5 border-t border-[#f1f5f9] py-[15px] first:border-t-0">
      <div className="min-w-0 flex-1">
        <b className="block truncate text-[16px] font-bold text-[#0f172a]">{title}</b>
        {sub && <span className="block truncate text-[13.5px] text-[#596578]">{sub}</span>}
      </div>
      {right && <div className="shrink-0 text-[14.5px] font-semibold text-[#4f46e5]">{right}</div>}
    </div>
  );
}
