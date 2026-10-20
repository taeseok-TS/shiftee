// 「계약서 보내기」 1단계 배치 — 즐겨찾기·묶음·카드 순서·용도 탭 순서(2026-10-20 본부 박정인 시안 v2 2·11번). 순수 모듈(화면·서버 공용).
//
// 본부 전체가 같은 배치를 본다(시안: 「본부 전체에 같은 순서」) — AppSetting 한 키에 JSON 으로 둔다(스키마 변경 없음, lib/contract-purpose 관례).
//  · favorites  ★ 줄 — 서류 한 장(tpl), 직접 만든 묶음(bundle), 기본 묶음(hire = 신규입사 묶음, resign = 퇴사 서류)
//  · bundles    직접 만든 묶음 — 이름 + 양식 id 목록(순서 = 보내는 순서, 첫 문서가 결재 순서의 기준)
//  · tplOrder   「내가 정한 순」 카드 순서(양식 id). 목록에 없는 양식은 뒤에 붙는다
//  · orderMode  usage = 많이 쓴 순(기본), manual = 내가 정한 순
//  · purposeOrder 용도 탭 순서 — 기본 채용 > 입사 > 재계약·연봉 > 퇴사 > 휴가·근태 신청 > 기타
import { DEFAULT_STEPS, parseApprovalSteps, stepsLabel } from "@/lib/approval-order";

export const SEND_LAYOUT_KEY = "contractSendLayout";
export const MAX_BUNDLES = 30;
export const MAX_BUNDLE_DOCS = 8;
export const MAX_FAVORITES = 12;

export type FavRef = { t: "tpl" | "bundle" | "hire" | "resign"; id: string };
export type SendBundle = { id: string; name: string; templateIds: string[] };
export type SendLayout = {
  rev: number;   // 저장할 때마다 1씩 — 다른 관리자가 그 사이 바꿨으면 저장을 거절하고 새로 불러오게(마지막 저장이 앞 저장을 지우지 않게)
  favorites: FavRef[];
  bundles: SendBundle[];
  tplOrder: string[];
  orderMode: "usage" | "manual";
  purposeOrder: string[];
};

export const DEFAULT_PURPOSE_ORDER = ["recruit", "hire", "renew", "resign", "leave", "other"];
export const DEFAULT_LAYOUT: SendLayout = {
  rev: 0,
  favorites: [{ t: "hire", id: "hire" }],
  bundles: [],
  tplOrder: [],
  orderMode: "usage",
  purposeOrder: DEFAULT_PURPOSE_ORDER,
};

const isStr = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 80;
const uniq = <T,>(a: T[]) => [...new Set(a)];

/** 저장값·요청값을 안전한 모양으로 — 모르는 값은 버린다. bundleIdOk 로 존재하는 묶음만 즐겨찾기에 남긴다 */
export function normalizeLayout(raw: unknown): SendLayout {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const bundles: SendBundle[] = Array.isArray(o.bundles)
    ? (o.bundles as unknown[]).flatMap((b) => {
        const x = (b && typeof b === "object" ? b : {}) as Record<string, unknown>;
        const name = typeof x.name === "string" ? x.name.trim().slice(0, 40) : "";
        const ids = Array.isArray(x.templateIds) ? uniq((x.templateIds as unknown[]).filter(isStr)).slice(0, MAX_BUNDLE_DOCS) : [];
        return isStr(x.id) && name && ids.length >= 2 ? [{ id: x.id, name, templateIds: ids }] : [];
      }).slice(0, MAX_BUNDLES)
    : [];
  const bundleIds = new Set(bundles.map((b) => b.id));
  const seenFav = new Set<string>();
  const favorites: FavRef[] = Array.isArray(o.favorites)
    ? (o.favorites as unknown[]).flatMap((f) => {
        const x = (f && typeof f === "object" ? f : {}) as Record<string, unknown>;
        const t = x.t;
        if (t !== "tpl" && t !== "bundle" && t !== "hire" && t !== "resign") return [];
        const id = t === "hire" || t === "resign" ? t : x.id;
        if (!isStr(id) || (t === "bundle" && !bundleIds.has(id))) return [];
        const k = `${t}:${id}`;
        if (seenFav.has(k)) return [];
        seenFav.add(k);
        return [{ t, id } as FavRef];
      }).slice(0, MAX_FAVORITES)
    : DEFAULT_LAYOUT.favorites;
  const tplOrder = Array.isArray(o.tplOrder) ? uniq((o.tplOrder as unknown[]).filter(isStr)).slice(0, 500) : [];
  const orderMode = o.orderMode === "manual" ? "manual" : "usage";
  const po = Array.isArray(o.purposeOrder) ? uniq((o.purposeOrder as unknown[]).filter((k): k is string => typeof k === "string" && DEFAULT_PURPOSE_ORDER.includes(k))) : [];
  const purposeOrder = [...po, ...DEFAULT_PURPOSE_ORDER.filter((k) => !po.includes(k))];
  const rev = typeof o.rev === "number" && Number.isInteger(o.rev) && o.rev >= 0 ? o.rev : 0;
  return { rev, favorites, bundles, tplOrder, orderMode, purposeOrder };
}

// ── 직접 만든 묶음의 규칙(화면·작성 폼 공용, 2026-10-20 검증) ──
// 서버 묶음 발송은 **대표 문서(근로자 전용이 아닌 첫 서류)의 결재 순서 하나**를 모든 서류에 쓴다. 그래서
//  · 「근로자 한 단계」 양식(동의서류)은 근로자 전용(employeeOnly)으로 따로 서명
//  · 나머지 서류는 결재 순서가 **모두 같아야** 묶는다 — 다르면(특히 순서 고정 양식) 대표 순서로 덮여 그 양식의 결재가 빠진다
type StepDoc = { name: string; approvalSteps?: unknown };
export const isEmployeeOnlyDoc = (d: StepDoc) => { const s = parseApprovalSteps(d.approvalSteps); return !!s && s.length === 1 && s[0].kind === "EMPLOYEE"; };
/** 개인정보 동의서 — 서명 화면의 동의 확인 단계(동의고유식별·동의채용정보)를 띄우는 서류 */
export const isConsentDoc = (d: { name: string }) => d.name.includes("개인정보") && d.name.includes("동의");
/** 묶을 수 없으면 이유, 묶을 수 있으면 null */
export function bundleProblem(docs: StepDoc[]): string | null {
  const main = docs.filter((d) => !isEmployeeOnlyDoc(d));
  if (main.length < 2) return null;
  const label = (d: StepDoc) => stepsLabel(parseApprovalSteps(d.approvalSteps) ?? DEFAULT_STEPS);
  const base = label(main[0]);
  const other = main.find((d) => label(d) !== base);
  return other ? `「${main[0].name}」(${base})와 「${other.name}」(${label(other)})는 결재 순서가 달라 한 묶음으로 보낼 수 없습니다. 따로 보내 주세요.` : null;
}

export function parseLayout(value: string | null | undefined): SendLayout {
  if (!value) return DEFAULT_LAYOUT;
  try { return normalizeLayout(JSON.parse(value)); } catch { return DEFAULT_LAYOUT; }
}
