// 계약 서명본 저장 실패를 **드러내고 스스로 고친다** (2026-09-04)
//
// 배경: 계약이 마지막 결재까지 끝나면 서명·직인이 찍힌 원본(signedUrl)을 만들어 저장한다.
// 그런데 이 생성은 gotenberg(LibreOffice) 를 거치므로 가끔 실패한다. 종전에는 그 실패가
// `console.error` 한 줄로 끝났다 — 컨테이너 로그는 아무도 안 보고, 계약은 화면상 "완료"인데
// **진본 원본만 없는** 상태로 조용히 남았다(검증관 A F1).
//
// 게다가 완료 여부를 status 로만 판단하면(검증관 A G1) 이 구멍이 안 보인다.
// "완료 = status SIGNED **이면서** signedUrl 이 있다" 로 봐야 한다.
import { prisma } from "@/lib/db";

/** 저장 실패를 시스템 로그에 남긴다 — 관리자 화면에 뜨고 매시 점검이 집계한다. */
export async function recordSignedDocFailure(contractId: string, e: unknown): Promise<void> {
  try {
    await prisma.systemErrorLog.create({
      data: {
        path: `/api/contracts/${contractId}/sign (서명본 저장)`,
        method: "POST",
        message: `서명본 저장 실패: ${e instanceof Error ? e.message : String(e)}`,
        stack: e instanceof Error ? e.stack?.slice(0, 4000) ?? null : null,
      },
    });
  } catch (inner) {
    // 기록조차 실패하면 최소한 눈에 보이게 남긴다 — 여기서 조용해지면 되돌릴 길이 없다.
    console.error("[signed-doc-heal] 실패 기록마저 실패:", inner);
  }
}

export type HealResult = { checked: number; healed: number; failed: number; failedIds: string[] };

/**
 * 완료됐는데 저장본이 없는 계약을 찾아 다시 만든다.
 *
 * - 방금 끝난 건은 건드리지 않는다(생성이 진행 중일 수 있다) — 10분 지난 것부터.
 * - 한 번에 5건까지만. 무거운 변환이라 점검 한 번이 오래 붙잡으면 안 된다.
 * - 고쳐도 안 되는 건은 목록으로 돌려준다 → 호출부가 알림에 싣는다.
 */
export async function healMissingSignedDocs(): Promise<HealResult> {
  const cutoff = new Date(Date.now() - 10 * 60 * 1000);
  const targets = await prisma.contract.findMany({
    where: { status: "SIGNED", signedUrl: null, updatedAt: { lt: cutoff } },
    select: { id: true, title: true },
    orderBy: { updatedAt: "desc" },
    take: 5,
  });
  const out: HealResult = { checked: targets.length, healed: 0, failed: 0, failedIds: [] };
  if (!targets.length) return out;

  const { generateAndStoreSignedDoc } = await import("@/lib/signed-doc");
  for (const c of targets) {
    try {
      const url = await generateAndStoreSignedDoc(c.id);
      if (url) { out.healed++; continue; }
      out.failed++; out.failedIds.push(c.id); // null 은 "만들지 못했다" 는 뜻이다
    } catch (e) {
      out.failed++; out.failedIds.push(c.id);
      await recordSignedDocFailure(c.id, e);
    }
  }
  return out;
}
