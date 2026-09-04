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

export type HealResult = {
  checked: number; healed: number; failed: number; failedIds: string[];
  /** 아직 저장본이 없는 계약의 **총** 개수(이번에 손댄 5건이 아니라). */
  backlog: number;
};

/**
 * 완료됐는데 저장본이 없는 계약을 찾아 다시 만든다.
 *
 * - 방금 끝난 건은 건드리지 않는다(생성이 진행 중일 수 있다) — 10분 지난 것부터.
 * - 한 번에 5건까지만. 무거운 변환이라 점검 한 번이 오래 붙잡으면 안 된다.
 * - 고쳐도 안 되는 건은 목록으로 돌려준다 → 호출부가 알림에 싣는다.
 */
export async function healMissingSignedDocs(): Promise<HealResult> {
  const cutoff = new Date(Date.now() - 10 * 60 * 1000);
  const where = { status: "SIGNED" as const, signedUrl: null, updatedAt: { lt: cutoff } };
  // ⚠ 종전에는 `desc` + take 5 였다. 그러면 **새로 깨진 것**이 상위 5를 차지해
  //   오래 방치된 건은 영원히 재시도도 알림도 못 받는다(2026-09-04 검증관 A S-2).
  //   오래된 것부터 처리한다.
  const targets = await prisma.contract.findMany({
    where, select: { id: true, title: true }, orderBy: { updatedAt: "asc" }, take: 5,
  });
  // ⚠ 알림에 실을 숫자는 이번에 손댄 5건이 아니라 **밀린 총량**이어야 한다.
  //   50건이 깨졌는데 "5건"으로 읽히면 규모를 오판한다(검증관 A S-2).
  const backlog = await prisma.contract.count({ where });
  const out: HealResult = { checked: targets.length, healed: 0, failed: 0, failedIds: [], backlog };
  if (!targets.length) return out;

  const { generateAndStoreSignedDoc } = await import("@/lib/signed-doc");
  for (const c of targets) {
    try {
      const url = await generateAndStoreSignedDoc(c.id);
      if (url) { out.healed++; continue; }
      // ⚠ null 은 두 가지다: 일시적 실패와 **원래 만들 수 없는 것**(서명 단계가 하나도 없는
      //   계약 — signed-doc.ts 의 `signers.length === 0`). 후자는 재시도해도 영원히 실패하고
      //   updatedAt 도 안 바뀌어 **매일 같은 id 를 알린다**(2026-09-04 검증관 A S-1).
      //   기록만 남기고 알림 대상에서는 뺀다 — 사람이 DB 를 봐야 풀리는 건이다.
      out.failed++;
      out.failedIds.push(c.id);
      await recordSignedDocFailure(c.id, new Error("서명본을 만들 수 없습니다(서명 단계 없음 등) — 확인 필요"));
    } catch (e) {
      out.failed++; out.failedIds.push(c.id);
      await recordSignedDocFailure(c.id, e);
    }
  }
  return out;
}
