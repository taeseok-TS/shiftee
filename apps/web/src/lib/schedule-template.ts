import { asHhmm, toMin } from "@/lib/schedule-payload";

// 근무일정 템플릿 입력 검사(2026-10-07 QA #10) — 추가·고치기가 같이 쓴다
export type TemplateInput = { code: string | null; name: string; startTime: string; endTime: string; branches: string[]; jobs: string[]; color: string | null; memo: string | null };

/** 본문 → 저장할 값(검증 실패면 오류 문구) */
export function parseTemplateBody(b: Record<string, unknown>): { ok: true; data: TemplateInput } | { ok: false; error: string } {
  const name = typeof b.name === "string" ? b.name.trim().slice(0, 60) : "";
  if (!name) return { ok: false, error: "템플릿 이름을 넣어 주세요." };
  const st = asHhmm(b.startTime), et = asHhmm(b.endTime);
  if (!st || !et) return { ok: false, error: "시간은 09:00 처럼 넣어 주세요." };
  if (toMin(et) <= toMin(st)) return { ok: false, error: "종료 시간이 시작 시간보다 빠릅니다." };
  if (toMin(et) - toMin(st) > 12 * 60) return { ok: false, error: "하루 근무는 12시간을 넘을 수 없습니다." };
  const list = (v: unknown) => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean))].slice(0, 30) : []);
  const color = typeof b.color === "string" && /^#[0-9a-fA-F]{6}$/.test(b.color) ? b.color : null;
  return {
    ok: true,
    data: {
      code: typeof b.code === "string" && b.code.trim() ? b.code.trim().slice(0, 40) : null,
      name, startTime: st, endTime: et,
      branches: list(b.branches), jobs: list(b.jobs), color,
      memo: typeof b.memo === "string" && b.memo.trim() ? b.memo.trim().slice(0, 200) : null,
    },
  };
}

