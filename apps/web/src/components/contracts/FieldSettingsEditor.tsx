"use client";

// 계약 양식 칸 설정 편집기(2026-10-13 QA76 #22 1단계) — 템플릿 수정 창 안에서 쓴다.
// 양식(.docx)의 {칸} 목록을 서버에서 받아, 칸마다 채우는 방식·자동 값·필수를 정한다. 저장은 부모(템플릿 PATCH)가 한다.
import { useEffect, useState } from "react";
import { AUTO_SOURCES, FIELD_MODES, type FieldMode, type FieldSettings } from "@/lib/contract-field-settings";

type FieldsResp = { fields: string[]; defaults: Record<string, FieldMode>; conditions?: string[] };

export default function FieldSettingsEditor({ templateId, value, onChange }: { templateId: string; value: FieldSettings; onChange: (v: FieldSettings) => void }) {
  const [info, setInfo] = useState<FieldsResp | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    let alive = true;
    fetch(`/api/contract-templates/${templateId}/fields`).then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (!alive) return;
      if (!d || !Array.isArray(d.fields)) { setErr("칸 목록을 읽지 못했습니다."); return; }
      setInfo({ fields: d.fields, defaults: d.defaults ?? {}, conditions: d.conditions });
    }).catch(() => { if (alive) setErr("칸 목록을 읽지 못했습니다."); });
    return () => { alive = false; };
  }, [templateId]);

  const set = (name: string, patch: Partial<FieldSettings[string]> | null) => {
    const next = { ...value };
    if (patch === null) delete next[name];
    else {
      const cur = { ...(next[name] ?? {}), ...patch };
      // 비워진 키는 지운다 — 기본값과 같으면 설정 자체를 없앤다. 단 출처·고정 문구가 있으면 mode "auto" 를 남긴다(서버는 mode 가 auto 인 칸에만 출처를 적용)
      if (!cur.source) delete cur.source;
      if (!cur.text) delete cur.text;
      if (cur.source || cur.text) cur.mode = "auto";
      else if (cur.mode === undefined || cur.mode === info?.defaults[name]) delete cur.mode;
      if (!cur.required) delete cur.required;
      if (Object.keys(cur).length) next[name] = cur; else delete next[name];
    }
    onChange(next);
  };

  if (err) return <p className="text-xs text-red-500">{err}</p>;
  if (!info) return <p className="text-xs text-gray-400">칸 목록을 읽는 중…</p>;
  if (info.fields.length === 0) return <p className="text-xs text-gray-400">이 양식에는 {"{칸}"}이 없습니다(PDF 양식이거나 치환 칸이 없는 워드).</p>;
  const count = Object.keys(value).filter((k) => info.fields.includes(k)).length;

  return (
    <div className="space-y-2">
      <p className="text-xs text-gray-500">
        칸 {info.fields.length}개{count ? ` · 바꾼 칸 ${count}개` : ""}. 「기본」은 종전 규칙(직원 정보·날짜는 자동, 「사유」류는 서명 때 직원, 나머지는 본부 입력)입니다.
        자동으로 채우는 칸을 보내기 전에 고치고 싶으면 「보내기 전 수정」으로 바꾸세요. 칸을 새로 만들려면 워드 양식에 {"{칸이름}"}을 넣고 파일을 교체한 뒤 여기서 방식을 정합니다.
      </p>
      <div className="max-h-72 overflow-auto border rounded-lg">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-gray-50">
            <tr className="text-left text-gray-500 border-b">
              <th className="px-2 py-1.5 font-medium">칸</th>
              <th className="px-2 py-1.5 font-medium w-40">채우는 방식</th>
              <th className="px-2 py-1.5 font-medium">자동 값(자동 입력일 때)</th>
              <th className="px-2 py-1.5 font-medium w-14 text-center">필수</th>
            </tr>
          </thead>
          <tbody>
            {info.fields.map((f) => {
              const s = value[f] ?? {};
              const def = info.defaults[f] ?? "hq";
              const mode = s.mode ?? def;
              const custom = !!s.mode && s.mode !== def;
              return (
                <tr key={f} className={`border-b last:border-0 ${custom || s.required || s.source || s.text ? "bg-amber-50/50" : ""}`}>
                  <td className="px-2 py-1.5 font-mono whitespace-nowrap">{`{${f}}`}</td>
                  <td className="px-2 py-1.5">
                    <select value={s.mode ?? ""} onChange={(e) => set(f, { mode: (e.target.value || undefined) as FieldMode | undefined })} className="h-7 w-full rounded border px-1 bg-white">
                      <option value="">기본({FIELD_MODES.find((m) => m.value === def)?.label})</option>
                      {FIELD_MODES.map((m) => <option key={m.value} value={m.value} title={m.hint}>{m.label}</option>)}
                    </select>
                  </td>
                  <td className="px-2 py-1.5">
                    {mode === "auto" ? (
                      <div className="flex gap-1">
                        <select value={s.source ?? ""} onChange={(e) => set(f, { source: e.target.value || undefined, text: e.target.value ? undefined : s.text })} className="h-7 rounded border px-1 bg-white">
                          <option value="">{def === "auto" && !s.text ? "(시스템 값)" : "(출처 고르기)"}</option>
                          {AUTO_SOURCES.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
                        </select>
                        {!s.source && (
                          <input value={s.text ?? ""} placeholder="또는 고정 문구" onChange={(e) => set(f, { text: e.target.value || undefined })} className="h-7 flex-1 rounded border px-2 bg-white" maxLength={200} />
                        )}
                      </div>
                    ) : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    {mode === "auto" ? <span className="text-gray-300">—</span> : (
                      <input type="checkbox" checked={!!s.required} onChange={(e) => set(f, { required: e.target.checked || undefined })} aria-label={`${f} 필수`} />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
