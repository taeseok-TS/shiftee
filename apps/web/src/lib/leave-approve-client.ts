// 휴가 승인 호출(화면 공용) — 잔여 부족 예외 승인(2026-10-22 본부 이예지 요청 4)
// 서버(api/leave/[id]/approve)가 잔여 부족으로 막으면서 canOverride(관리자=본부)를 주면, 안내를 그대로 보여 주고
// 한 번 더 확인을 받아 overrideShortBalance 로 다시 부른다. 원장 단계는 서버가 canOverride 를 주지 않아 종전처럼 막힌다.
export async function postLeaveApprove(id: string, extra: Record<string, unknown> = {}): Promise<{ ok: boolean; error: string; cancelled?: boolean }> {
  const send = (override: boolean) => fetch(`/api/leave/${id}/approve`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "approve", ...extra, ...(override ? { overrideShortBalance: true } : {}) }),
  });
  let res = await send(false);
  let data = await res.json().catch(() => ({}));
  if (!res.ok && data?.code === "SHORT_BALANCE" && data?.canOverride) {
    if (!confirm(`${data.error}\n\n본부 예외로 승인할까요?\n승인하면 잔여는 마이너스로 남고, 변경 로그에 「잔여 부족 예외 승인」으로 기록됩니다.`)) {
      return { ok: false, error: "", cancelled: true };
    }
    res = await send(true);
    data = await res.json().catch(() => ({}));
  }
  if (!res.ok) return { ok: false, error: data?.error || "처리 중 오류가 발생했습니다" };
  return { ok: true, error: "" };
}
