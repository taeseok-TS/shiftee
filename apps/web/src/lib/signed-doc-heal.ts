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
  /** 완료본 고정(#205-5) — 이번에 고정한 수·실패·밀린 총량 */
  frozen: number; freezeFailed: number; freezeFailedIds: string[]; freezeBacklog: number;
  /** 제3자 시각 도장(TSA) — 이번에 받은 수·실패·밀린 총량 */
  stamped: number; stampFailed: number; stampBacklog: number;
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
  const out: HealResult = { checked: targets.length, healed: 0, failed: 0, failedIds: [], backlog, frozen: 0, freezeFailed: 0, freezeFailedIds: [], freezeBacklog: 0, stamped: 0, stampFailed: 0, stampBacklog: 0 };

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

  // 완료본은 있는데 고정 PDF 가 없는 계약 — 고정 실패분과 9/11 이전 완료분(백필). 오래된 것부터 5건씩.
  const freezeWhere = { status: "SIGNED" as const, signedUrl: { not: null }, signedPdfUrl: null, updatedAt: { lt: cutoff } };
  // 최근 6시간 안에 고정에 실패한 계약은 건너뛴다 — 안 되는 몇 건이 맨 앞을 막아 뒤 계약이 영영 고정되지 않거나,
  // 매시간 같은 실패가 오류 로그에 쌓이지 않게(8330d85 검증 3). 6시간마다는 다시 시도한다.
  const recentFails = await prisma.systemErrorLog.findMany({
    where: { createdAt: { gt: new Date(Date.now() - 6 * 3600 * 1000) }, message: { contains: "완료본 고정 실패" } },
    select: { path: true }, take: 500,
  });
  const skip = [...new Set(recentFails.map((l) => /\/api\/contracts\/([^/ ]+)\//.exec(l.path || "")?.[1]).filter((x): x is string => !!x))];
  const toFreeze = await prisma.contract.findMany({
    where: { ...freezeWhere, ...(skip.length ? { id: { notIn: skip } } : {}) },
    select: { id: true }, orderBy: { updatedAt: "asc" }, take: 5,
  });
  const { freezeSignedPdf } = await import("@/lib/signed-freeze");
  for (const c of toFreeze) {
    try {
      if (await freezeSignedPdf(c.id)) { out.frozen++; continue; }
      // null = 그 사이 완료가 풀렸다(경쟁) — 실패로 세지 않는다
    } catch (e) {
      out.freezeFailed++; out.freezeFailedIds.push(c.id);
      await recordSignedDocFailure(c.id, new Error(`완료본 고정 실패 — ${e instanceof Error ? e.message : String(e)}`));
    }
  }
  out.freezeBacklog = await prisma.contract.count({ where: freezeWhere });

  // 제3자 시각 도장(TSA) — 고정됐는데 도장이 없는 완료본(실패분 + 9/12 이전 고정분). 오래된 것부터 5건씩. 실패는 다음 시간에 다시.
  const stampWhere = { status: "SIGNED" as const, signedSha256: { not: null }, tsaToken: null, signedPdfAt: { lt: cutoff } };
  const toStamp = await prisma.contract.findMany({ where: stampWhere, select: { id: true, signedSha256: true }, orderBy: { signedPdfAt: "asc" }, take: 3 }); // 요청 간격 15초라 3건씩(봇 틱이 오래 붙잡히지 않게)
  if (toStamp.length) {
    const { stampFrozen } = await import("@/lib/tsa");
    for (const c of toStamp) {
      const r = await stampFrozen(c.id, c.signedSha256!);
      if (r === true) out.stamped++;
      else if (r === false) { out.stampFailed++; break; } // TSA 가 멈췄으면 첫 실패에서 그만 — 봇 틱이 밀리지 않게(2cdaf5c 검증 5)
    }
  }
  out.stampBacklog = await prisma.contract.count({ where: stampWhere });
  return out;
}
