// 아래 탭 · 더보기 줄의 주황 숫자(2026-10-23 본부 요청 앱 1 · 8) — 승인 대기 수 · 서명할 계약서 수를 한곳에서 센다.
// AppNavigator 가 주기적으로 refreshBadges() 를 부르고, 승인 · 서명한 화면도 바로 부른다(숫자가 늦게 줄지 않게).
// 못 세면 이전 숫자를 그대로 둔다(0으로 속이지 않게).
import { useEffect, useState } from "react";
import { DeviceEventEmitter } from "react-native";
import * as api from "./api";
import { canApproveNow, myInboxCount } from "./approvals";

export type BadgeCounts = { approvals: number | null; sign: number | null; approver: boolean };
let counts: BadgeCounts = { approvals: null, sign: null, approver: false };
const EVT = "cubetee:badges";
let inflight: Promise<void> | null = null;
// 승인 화면에서 「승인」을 눌러 아직 서버가 처리하지 않은 건 수(되돌리기 5초 유예 중 · 보내고 응답 전) — 서버 숫자에서 뺀다(2026-10-23 검증 B1-e)
let held = 0;
// 로그아웃 · 계정 바뀜마다 1씩 — 그 전에 출발한 새로 고침 결과가 새 계정 숫자를 덮지 않게(검증 B5)
let gen = 0;

export const getBadgeCounts = () => counts;

/** 로그아웃 · 다른 계정 로그인 — 숫자 · 결재자 판정을 비운다(AuthContext 가 로그인 상태가 바뀔 때 부른다) */
export function resetBadges() {
  gen++;
  held = 0;
  inflight = null;
  counts = { approvals: null, sign: null, approver: false };
  DeviceEventEmitter.emit(EVT, counts);
}

export function refreshBadges(): Promise<void> {
  if (inflight) return inflight;
  const my = gen;
  const p: Promise<void> = (async () => {
    const [ok, sign] = await Promise.all([
      canApproveNow().catch(() => null),
      api.getMyContractApprovals().then((l) => l.length).catch(() => null),
    ]);
    if (my !== gen) return;
    const next: BadgeCounts = { ...counts };
    if (ok !== null) next.approver = ok;
    if (next.approver) {
      const n = await myInboxCount().catch(() => null);
      if (my !== gen) return;
      if (n != null) next.approvals = Math.max(0, n - held);
    } else if (ok === false) next.approvals = 0;
    if (sign != null) next.sign = sign;
    counts = next;
    DeviceEventEmitter.emit(EVT, counts);
  })().finally(() => { if (inflight === p) inflight = null; });
  inflight = p;
  return p;
}

/** 승인 하나를 처리했을 때 — 서버를 다시 세기 전에 숫자부터 하나 줄인다 */
export function bumpApprovals(delta: number) {
  if (counts.approvals == null) return;
  counts = { ...counts, approvals: Math.max(0, counts.approvals + delta) };
  DeviceEventEmitter.emit(EVT, counts);
}

/** 승인 유예 시작(+1) · 되돌리기(-1) — 서버가 세는 숫자에서 이 건을 빼 두고, 화면 숫자도 바로 맞춘다 */
export function holdApproval(delta: 1 | -1) {
  held = Math.max(0, held + delta);
  bumpApprovals(-delta);
}
/** 보낸 승인에 서버 응답이 왔다(성공 · 실패 모두) — 이제 서버 숫자에 반영돼 있으니 빼 두던 것을 푼다. 숫자는 다음 새로 고침이 맞춘다 */
export function releaseApproval() {
  held = Math.max(0, held - 1);
}

export function useBadgeCounts(): BadgeCounts {
  const [c, setC] = useState<BadgeCounts>(counts);
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(EVT, (v: BadgeCounts) => setC(v));
    return () => sub.remove();
  }, []);
  return c;
}

/** 아래 탭 숫자 모양 — 주황(대기) */
export const badgeStyle = { backgroundColor: "#f59e0b", color: "#fff", fontSize: 11, fontWeight: "700" as const };
export const badgeText = (n: number | null | undefined) => (n && n > 0 ? (n > 99 ? "99+" : n) : undefined);
