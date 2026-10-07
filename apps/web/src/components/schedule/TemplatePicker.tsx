"use client";

import { useEffect, useState } from "react";

/**
 * 근무일정 템플릿에서 시간 고르기(2026-10-07 QA #10) — 일정 추가·일괄 등록 창이 같이 쓴다.
 * branch 를 주면 그 지점에서 쓸 수 있는 것(전사 공통 + 그 지점 전용)만, 없으면 내가 볼 수 있는 전부.
 * 고르면 시작·종료 시간을 채운다(직접 고칠 수도 있다).
 */
type Tpl = { id: string; name: string; startTime: string; endTime: string; branches: string[] };

export function TemplatePicker({ branch, onPick }: { branch?: string | null; onPick: (start: string, end: string) => void }) {
  const [list, setList] = useState<Tpl[]>([]);
  const [value, setValue] = useState("");
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let alive = true;
    fetch(`/api/schedule-templates${branch ? `?branch=${encodeURIComponent(branch)}` : ""}`)
      .then((r) => (r.ok ? r.json() : { templates: [] }))
      .then((d) => { if (alive) { setList(d.templates || []); setValue(""); setLoaded(true); } })
      .catch(() => { if (alive) setLoaded(true); });
    return () => { alive = false; };
  }, [branch]);
  if (!list.length) return <p className="text-xs text-gray-400">{loaded ? "쓸 수 있는 템플릿이 없습니다 — 시간을 직접 넣어 주세요." : "템플릿을 불러오는 중…"}</p>;
  return (
    <select
      className="w-full h-9 rounded-md border px-2 text-sm"
      value={value}
      onChange={(e) => {
        setValue(e.target.value);
        const t = list.find((x) => x.id === e.target.value);
        if (t) onPick(t.startTime, t.endTime);
      }}
    >
      <option value="">템플릿에서 고르기 (선택)</option>
      {list.map((t) => (
        <option key={t.id} value={t.id}>
          {t.name} · {t.startTime}~{t.endTime}{t.branches.length ? "" : " · 공통"}
        </option>
      ))}
    </select>
  );
}
