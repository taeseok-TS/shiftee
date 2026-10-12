"use client";

import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronDown, Settings2 } from "lucide-react";
import {
  type SchedulePrefs, type ShowKey, type SortKey, type WeekStart,
  SHOW_KEYS, SHOW_LABEL, SORT_KEYS, SORT_LABEL, WEEK_START_OPTIONS,
} from "@/lib/schedule-view";

/**
 * 근무일정 필터·보기 설정 조각(2026-10-12 QA #72 #73) — 본부·원장 근무일정이 같이 쓴다.
 *  · <MultiPick>: 지점·직무·부서를 여러 개 동시에 고르는 체크 목록. 아무것도 고르지 않으면 「전체」. 바깥을 누르면 닫힌다
 *  · <ViewSettingsMenu>: 정렬 · 표시 항목 · 주 시작 요일. 값은 사람마다 저장(/api/me/prefs)
 */
export function MultiPick({ label, options, value, onChange, allLabel = "전체", className }: {
  label: string; options: string[]; value: string[]; onChange: (v: string[]) => void; allLabel?: string; className?: string;
}) {
  const picked = value.filter((v) => options.includes(v));   // 목록에서 사라진 값(퇴사 지점 등)은 세지 않는다
  const text = picked.length === 0 ? allLabel : picked.length <= 2 ? picked.join(", ") : `${picked.slice(0, 2).join(", ")} 외 ${picked.length - 2}`;
  const toggle = (o: string, on: boolean) => onChange(on ? [...new Set([...value, o])] : value.filter((v) => v !== o));
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={`inline-flex h-9 items-center gap-1.5 rounded-md border bg-white px-3 text-sm hover:bg-gray-50 ${picked.length ? "border-blue-400 text-blue-800" : "text-gray-700"} ${className ?? ""}`}
        aria-label={`${label} 필터`}>
        <span className="text-xs text-gray-500">{label}</span>
        <span className="font-medium max-w-[200px] truncate">{text}</span>
        <ChevronDown size={14} className="text-gray-400" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[200px] max-h-[60vh] overflow-y-auto">
        <DropdownMenuItem onClick={() => onChange([])} className={picked.length === 0 ? "font-semibold" : ""}>{allLabel}</DropdownMenuItem>
        <DropdownMenuSeparator />
        {options.length === 0 && <div className="px-2 py-1.5 text-xs text-gray-400">항목이 없습니다</div>}
        {options.map((o) => (
          <DropdownMenuCheckboxItem key={o} checked={picked.includes(o)} onCheckedChange={(on) => toggle(o, !!on)} closeOnClick={false}>
            {o}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ViewSettingsMenu({ prefs, onChange, hideShow = [] }: {
  prefs: SchedulePrefs; onChange: (patch: Partial<SchedulePrefs>) => void; hideShow?: ShowKey[];
}) {
  const setShow = (k: ShowKey, on: boolean) => onChange({ show: { ...prefs.show, [k]: on } });
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="inline-flex h-8 items-center gap-1.5 rounded-md border bg-white px-2.5 text-xs text-gray-700 hover:bg-gray-50" aria-label="보기 설정">
        <Settings2 size={14} />보기 설정
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[220px] max-h-[70vh] overflow-y-auto">
        <DropdownMenuLabel>정렬</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={prefs.sort} onValueChange={(v) => onChange({ sort: v as SortKey })}>
          {SORT_KEYS.map((k) => <DropdownMenuRadioItem key={k} value={k} closeOnClick={false}>{SORT_LABEL[k]}</DropdownMenuRadioItem>)}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>표시 항목</DropdownMenuLabel>
        {SHOW_KEYS.filter((k) => !hideShow.includes(k)).map((k) => (
          <DropdownMenuCheckboxItem key={k} checked={prefs.show[k]} onCheckedChange={(on) => setShow(k, !!on)} closeOnClick={false}>{SHOW_LABEL[k]}</DropdownMenuCheckboxItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuLabel>한 주의 시작 요일</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={String(prefs.weekStart)} onValueChange={(v) => onChange({ weekStart: Number(v) as WeekStart })}>
          {WEEK_START_OPTIONS.map((o) => <DropdownMenuRadioItem key={o.value} value={String(o.value)} closeOnClick={false}>{o.label}</DropdownMenuRadioItem>)}
        </DropdownMenuRadioGroup>
        <div className="px-2 pt-1.5 pb-1 text-[11px] text-gray-400 leading-4">주 49시간 합계는 법정 기준(월~일)이라 월요일 시작일 때만 실제 시간까지 보입니다.</div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
