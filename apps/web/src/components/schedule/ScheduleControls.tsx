"use client";

import { jobGroupLabel } from "@/lib/job-group-label";
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronDown, Settings2 } from "lucide-react";
import {
  type SchedulePrefs, type ShowKey, type SortKey,
  SHOW_KEYS, SHOW_LABEL, SORT_KEYS, SORT_LABEL,
} from "@/lib/schedule-view";

// 보기 설정 이름표 — 지점은 묶음 제목에 한 번만 나오므로(■3 시안 R18) 「직무·지점」 → 「직무」
const SHOW_TEXT: Record<ShowKey, string> = { ...SHOW_LABEL, subline: "직무", typeBadge: "유형(목록형)", leave: "휴가(목록형)" };

/**
 * 근무일정 필터·보기 설정 조각(2026-10-12 QA #72 #73) — 본부·원장 근무일정이 같이 쓴다.
 *  · <MultiPick>: 지점·직무를 여러 개 동시에 고르는 체크 목록. 아무것도 고르지 않으면 「전체」. 바깥을 누르면 닫힌다
 *  · <ViewSettingsMenu>: 정렬 · 표시 항목. 값은 사람마다 저장(/api/me/prefs)
 *    한 주는 늘 월~일(2026-10-23 ■4) — 예전 「한 주의 시작 요일」 고르기는 뺐다(저장된 값은 쓰지 않는다)
 */
export function MultiPick({ label, options, value, onChange, allLabel = "전체", className }: {
  label: string; options: string[]; value: string[]; onChange: (v: string[]) => void; allLabel?: string; className?: string;
}) {
  const picked = value.filter((v) => options.includes(v));   // 목록에서 사라진 값(퇴사 지점 등)은 세지 않는다
  const shown = picked.map(jobGroupLabel);   // 직군 저장 값 「코디」는 「코디네이터」로 보인다(2026-10-28 이예지 — 다른 선택지는 그대로)
  const text = picked.length === 0 ? allLabel : picked.length <= 2 ? shown.join(", ") : `${shown.slice(0, 2).join(", ")} 외 ${picked.length - 2}`;
  const toggle = (o: string, on: boolean) => onChange(on ? [...new Set([...value, o])] : value.filter((v) => v !== o));
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={`inline-flex h-[38px] items-center gap-1.5 rounded-[10px] border bg-white px-3 text-[13.5px] hover:bg-[#f8fafc] ${picked.length ? "border-[#c7d2fe] text-[#4f46e5]" : "border-[#e2e8f0] text-[#334155]"} ${className ?? ""}`}
        aria-label={`${label} 필터`}>
        <span className="text-[12.5px] text-[#596578]">{label}</span>
        <span className="font-medium max-w-[200px] truncate">{text}</span>
        <ChevronDown size={14} strokeWidth={2.2} className="text-[#64748b]" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[200px] max-h-[60vh] overflow-y-auto">
        <DropdownMenuItem onClick={() => onChange([])} className={picked.length === 0 ? "font-semibold" : ""}>{allLabel}</DropdownMenuItem>
        <DropdownMenuSeparator />
        {options.length === 0 && <div className="px-2 py-1.5 text-xs text-gray-400">항목이 없습니다</div>}
        {options.map((o) => (
          <DropdownMenuCheckboxItem key={o} checked={picked.includes(o)} onCheckedChange={(on) => toggle(o, !!on)} closeOnClick={false}>
            {jobGroupLabel(o)}
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
      <DropdownMenuTrigger className="inline-flex min-h-9 items-center gap-1.5 rounded-[10px] border border-[#e2e8f0] bg-white px-3 text-[13px] font-semibold text-[#475569] hover:bg-[#f8fafc]" aria-label="보기 설정">
        <Settings2 size={14} />보기 설정
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[220px] max-h-[70vh] overflow-y-auto">
        {/* 제목(GroupLabel)은 Base UI 규칙상 Group/RadioGroup 안에 있어야 한다 — 밖에 두면 운영에서 오류 #31 로 화면이 깨졌다(10/12) */}
        <DropdownMenuRadioGroup value={prefs.sort} onValueChange={(v) => onChange({ sort: v as SortKey })}>
          <DropdownMenuLabel>정렬</DropdownMenuLabel>
          {SORT_KEYS.map((k) => <DropdownMenuRadioItem key={k} value={k} closeOnClick={false}>{SORT_LABEL[k]}</DropdownMenuRadioItem>)}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>표시 항목</DropdownMenuLabel>
          {SHOW_KEYS.filter((k) => !hideShow.includes(k)).map((k) => (
            <DropdownMenuCheckboxItem key={k} checked={prefs.show[k]} onCheckedChange={(on) => setShow(k, !!on)} closeOnClick={false}>{SHOW_TEXT[k]}</DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
