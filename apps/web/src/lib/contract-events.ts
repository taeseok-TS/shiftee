import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

/**
 * 계약 이벤트(감사 기록, #205-4 이예지대리 · 디렉터 9/11) — 발송·재발송·수정·결재 초기화·열람·본인 확인·전자서명 동의·
 * 서명·완료·반려·회수를 **시각·사람·IP·기기**와 함께 남긴다. 분쟁 때 "누가·언제·무엇에 서명했는지"의 근거.
 *
 * ⚠ 기록 실패가 업무(서명·발송)를 막으면 안 된다 — 트랜잭션 **밖**에서 부르고, 실패는 삼키고 서버 로그만 남긴다.
 *   (Postgres 는 트랜잭션 안의 실패 문장이 트랜잭션 전체를 무너뜨린다.)
 * ⚠ GET 에서는 부르지 않는다 — 무중단 배포 프록시가 GET 을 재시도한다. 열람은 화면이 POST 로 알린다.
 */
export type ContractEventType =
  | "SENT" | "RESEND" | "EDITED" | "RESET" | "VIEWED" | "VERIFY_OK" | "VERIFY_FAIL"
  | "CONSENT" | "SIGNED" | "COMPLETED" | "REJECTED" | "REVOKED" | "FROZEN";

/** 요청에서 IP·브라우저·기기 — 프록시(Caddy)가 x-forwarded-for 에 실제 접속 IP 를 넣는다(첫 값). 앱은 x-device-id 를 싣는다. */
export function requestInfo(req?: Request | null) {
  if (!req) return { ip: null, userAgent: null, deviceId: null };
  const h = req.headers;
  const xff = h.get("x-forwarded-for");
  const ip = ((xff ? xff.split(",")[0] : h.get("x-real-ip")) || "").trim().slice(0, 64) || null;
  return {
    ip,
    userAgent: (h.get("user-agent") || "").slice(0, 300) || null,
    deviceId: (h.get("x-device-id") || "").slice(0, 100) || null,
  };
}

export async function recordContractEvent(input: {
  contractId: string;
  type: ContractEventType;
  actorId?: string | null;
  actorName?: string | null;
  stepOrder?: number | null;
  meta?: Record<string, unknown> | null;
  request?: Request | null;
}): Promise<void> {
  try {
    const r = requestInfo(input.request);
    await prisma.contractEvent.create({
      data: {
        contractId: input.contractId,
        type: input.type,
        actorId: input.actorId ?? null,
        actorName: input.actorName ?? null,
        stepOrder: input.stepOrder ?? null,
        ip: r.ip,
        userAgent: r.userAgent,
        deviceId: r.deviceId,
        ...(input.meta ? { meta: input.meta as Prisma.InputJsonValue } : {}),
      },
    });
  } catch (e) {
    console.error("[contract-event] 기록 실패(업무는 계속):", input.type, input.contractId, e);
  }
}
