// 포털 연봉 연동 — 서명이 끝난 근로·연봉계약서를 직영 포털로 보낸다(2026-10-29 이예지 요청, 11/3 키 등록).
//  · 디렉터 결정(10/29): **앞으로 큐브티에서 서명이 끝나는 근로·연봉계약서만** 보낸다. 지난 체결본(모두싸인 이관분)은 보내지 않는다.
//  · POST $PORTAL_CONTRACT_URL (기본 jikyoung-portal-one …/api/import/cubetee-contract), Authorization: Bearer $PORTAL_CONTRACT_KEY
//    본문 { contracts: [{ contract_no, ems_id, annual, start_date, end_date, signed_at, pdf_url }] } — 같은 contract_no 는 포털이 덮어쓴다
//  · 대상: SIGNED · 시험 아님 · 외부 계약 아님 · 옮겨 온 것(importBatch) 아님 · 제목이 근로/고용/파트타임/연봉 계약서(확인서·동의서 등 제외)
//    · 사번 있음 · **연봉 칸 있음**(연봉 없는 계약직 양식은 보내지 않는다 — null 로 포털 연봉을 덮지 않게, 검증 7) · 고정 완료본(문서번호) 있음
//  · contract_no 는 계약 id — 회수 뒤 다시 완료돼 문서번호가 바뀌어도 포털에서 같은 줄을 덮어쓴다(검증 6)
//  · 완료본 한 벌(문서번호)마다 한 번 — 성공 기록(PORTAL_SENT)의 meta.docKey 로 판정(external-delivery 와 같은 방식)
//  · 성공은 포털이 saved ≥ 1 을 돌려줄 때만(검증 2). 400·422 처럼 내용이 틀린 거절은 한 번만 기록하고 멈추고, 멈춘 건 수는 매일 점검 알림에 싣는다.
//    그 밖(saved 0 — 인사카드가 아직 없는 신규 입사자 등 · 키 오류 401·403 · 주소 오류 404 · 장애 · 시간 초과)은 14일 동안 다시 보낸다:
//    처음 3번은 매시, 그 뒤로는 6시간마다(최종 재검증 1·2)
//    다시 보내려면 그 계약의 PORTAL_FAIL 기록을 지우면 다음 점검이 다시 보낸다
//  · 포털 인사카드의 같은 사번이 다른 이름이면 보내지 않는다(portal-hr-salary 와 같은 규칙, 검증 8)
//  · pdf_url 은 7일짜리 계약 전용 열람 링크(?st=). 열람 전용 양식도 받도록 inline=1(검증 1). 포털이 받을 때 내려받아 보관한다(이예지 10/29 답)
import { prisma } from "@/lib/db";
import { recordContractEvent } from "@/lib/contract-events";

const DEFAULT_URL = "https://jikyoung-portal-one.vercel.app/api/import/cubetee-contract";
const LINK_TTL_MS = 7 * 24 * 3600 * 1000;
const RETRY_DAYS = 14;
const FAST_TRIES = 3;
const SLOW_GAP_MS = 6 * 3600 * 1000;
const TARGET_TITLE = /근로\s*계약서|고용\s*계약서|파트\s*타임\s*계약서|연봉\s*계약서/;
const NOT_TARGET = /확인서|동의서|신청서|서약서|합의서|통지서/;

function portalUrl(): string { return (process.env.PORTAL_CONTRACT_URL || "").trim() || DEFAULT_URL; }
function portalKey(): string { return (process.env.PORTAL_CONTRACT_KEY || "").trim(); }
export function portalContractPushEnabled(): boolean { return !!portalKey(); }

const ymd = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);   // @db.Date 는 UTC 자정 저장
function kstIso(d: Date): string {
  const k = new Date(d.getTime() + 9 * 3600 * 1000);
  return `${k.toISOString().slice(0, 19)}+09:00`;
}
/** 작성 때 넣은 연봉(extraFields 「연봉」 = "34,000,000원") → 원 단위 정수. 없거나 말이 안 되면 null */
function annualOf(extra: unknown): number | null {
  const v = (extra as Record<string, unknown> | null)?.["연봉"];
  if (typeof v !== "string" && typeof v !== "number") return null;
  const n = Number(String(v).replace(/[^0-9]/g, ""));
  return Number.isFinite(n) && n >= 1_000_000 && n <= 1_000_000_000 ? n : null;
}

export type PortalPushResult = "sent" | "skipped" | "failed" | "gave_up";
type FailMeta = { docKey?: string; permanent?: boolean };

export async function pushContractToPortal(contractId: string): Promise<PortalPushResult> {
  if (!portalContractPushEnabled()) return "skipped";
  const c = await prisma.contract.findUnique({
    where: { id: contractId },
    select: {
      id: true, title: true, status: true, isTest: true, importBatch: true, externalName: true,
      docNo: true, signedPdfUrl: true, signedAt: true, startDate: true, endDate: true, extraFields: true,
      user: { select: { id: true, empNo: true, name: true } },
    },
  });
  if (!c || c.status !== "SIGNED" || c.isTest || c.importBatch || c.externalName) return "skipped";
  if (!TARGET_TITLE.test(c.title) || NOT_TARGET.test(c.title) || c.user?.empNo == null) return "skipped";
  if (!c.signedPdfUrl || !c.docNo || !c.signedAt) return "skipped";   // 고정 전 — 매시 점검이 고정한 뒤 다시 부른다
  const annual = annualOf(c.extraFields);
  if (annual == null) return "skipped";
  const docKey = c.docNo;
  const prev = await prisma.contractEvent.findMany({ where: { contractId, type: { in: ["PORTAL_SENT", "PORTAL_FAIL"] } }, select: { type: true, meta: true, createdAt: true } });
  const mine = prev.filter((e) => (e.meta as FailMeta | null)?.docKey === docKey);
  if (mine.some((e) => e.type === "PORTAL_SENT")) return "skipped";
  const fails = mine.filter((e) => e.type === "PORTAL_FAIL");
  if (fails.some((e) => (e.meta as FailMeta | null)?.permanent)) return "gave_up";
  const lastFail = fails.reduce((t, e) => Math.max(t, e.createdAt.getTime()), 0);
  if (fails.length >= FAST_TRIES && Date.now() - lastFail < SLOW_GAP_MS) return "skipped";

  const fail = async (error: string, permanent: boolean): Promise<PortalPushResult> => {
    await recordContractEvent({ contractId, type: "PORTAL_FAIL", actorName: "큐브티 봇", meta: { docKey, error: error.slice(0, 300), permanent } });
    console.error("[portal-contract] 포털 전송 실패:", contractId, error);
    return "failed";
  };

  // 사번이 우연히 겹친 다른 사람에게 붙지 않게 — 포털 인사카드에 같은 사번 · 다른 이름이면 멈춘다(포털을 못 읽으면 그대로 보낸다)
  const { portalSalaryFor } = await import("@/lib/portal-hr-salary");
  const chk = await portalSalaryFor([{ id: c.user.id, empNo: c.user.empNo, name: c.user.name }]).catch(() => null);
  if (chk?.portal === "ok" && chk.byUser[c.user.id]?.reason === "name_mismatch")
    return fail("포털 인사카드의 같은 사번 이름이 달라 보내지 않았습니다 — 사번 확인 필요", true);

  const { issueSignedDocTicket } = await import("@/lib/upload-ticket");
  const { getAppUrl } = await import("@/lib/app-url");
  const row = {
    contract_no: c.id,
    ems_id: String(c.user.empNo).padStart(5, "0"),
    annual,
    start_date: ymd(c.startDate),
    end_date: ymd(c.endDate),
    signed_at: kstIso(c.signedAt),
    pdf_url: `${getAppUrl()}/api/contracts/${c.id}/signed-document?st=${issueSignedDocTicket(c.id, LINK_TTL_MS)}&pdf=1&inline=1`,
  };
  try {
    const res = await fetch(portalUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${portalKey()}` },
      body: JSON.stringify({ contracts: [row] }),
      signal: AbortSignal.timeout(15_000),
    });
    const text = await res.text().catch(() => "");
    if (!res.ok) return fail(`HTTP ${res.status} ${text.slice(0, 200)}`, [400, 413, 415, 422].includes(res.status));
    let body: { saved?: unknown; alert?: unknown } | null = null;
    try { body = JSON.parse(text); } catch { /* 아래에서 실패 처리 */ }
    const saved = typeof body?.saved === "number" ? body.saved : 0;
    if (saved < 1) return fail(`포털이 저장하지 않았습니다(saved=${String(body?.saved ?? "없음")}${body?.alert ? ` · ${String(body.alert)}` : ""})`, false);
    await recordContractEvent({ contractId, type: "PORTAL_SENT", actorName: "큐브티 봇", meta: { docKey, saved, annual, alert: body?.alert ?? null } });
    return "sent";
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e), false);
  }
}

/** 부르는 곳은 기다리지 않는다(포털이 느려도 서명 응답이 늦지 않게) */
export function pushContractToPortalLater(contractId: string): void {
  pushContractToPortal(contractId).catch((e) => console.error("[portal-contract] 포털 전송 오류:", contractId, e));
}

let retrying = false;   // 봇 틱이 겹쳐 돌아도 같은 건을 두 번 보내지 않게(검증 4)

/** 매시 점검 — 최근 14일 안 완료된 대상 중 아직 못 보낸 것을 다시 보낸다(완료 때 실패 · 고정이 늦게 끝난 건 · 회수 뒤 다시 완료된 건).
 *  보낼지는 pushContractToPortal 이 문서번호(docKey) 기준으로 판정한다 — 보낼 필요 없는 건은 DB 만 보고 넘어가 칸을 차지하지 않는다(재검증 1·2).
 *  포털로 실제 보내는 시간은 한 번에 60초까지 */
export async function retryPortalPushes(): Promise<{ sent: number; failed: number; failedIds: string[]; gaveUp: number }> {
  const out = { sent: 0, failed: 0, failedIds: [] as string[], gaveUp: 0 };
  if (!portalContractPushEnabled() || retrying) return out;
  retrying = true;
  try {
    const rows = await prisma.contract.findMany({
      where: {
        status: "SIGNED", isTest: false, importBatch: null, externalName: null, signedPdfUrl: { not: null },
        signedAt: { gte: new Date(Date.now() - RETRY_DAYS * 86400_000) },
        OR: [{ title: { contains: "근로" } }, { title: { contains: "고용" } }, { title: { contains: "파트" } }, { title: { contains: "연봉" } }],
      },
      orderBy: { signedAt: "asc" },
      select: { id: true },
      take: 1000,
    });
    const until = Date.now() + 60_000;
    for (const r of rows) {
      if (Date.now() > until) break;
      const res = await pushContractToPortal(r.id);
      if (res === "sent") out.sent++;
      else if (res === "failed") { out.failed++; out.failedIds.push(r.id); }
      else if (res === "gave_up") out.gaveUp++;
    }
  } finally {
    retrying = false;
  }
  return out;
}
