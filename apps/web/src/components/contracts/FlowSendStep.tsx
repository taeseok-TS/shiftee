"use client";

// 계약서 보내기 3단계 — 결재자·발송(2026-10-20 본부 박정인 시안 v2 1·4번).
// 2단계에서 만든 초안을 받아 결재선을 정하고 한 번에 보낸다. 결재선 규칙·발송은 「선택한 초안 한꺼번에 발송」과 같은
// bulk-send-core 하나다(양식 순서대로: 본부 = 고른 한 명, 원장 = 지점 메인 원장 자동, 근로자 = 당사자).
// 「이전」으로 내용 입력에 돌아가면 방금 만든 초안을 지운다(같은 사람에게 초안이 두 벌 생기지 않게).
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Eye } from "lucide-react";
import { cn } from "@/lib/utils";
import { KIND_LABEL } from "@/lib/approval-order";
import {
  approverIdsOf, isMultiHq, mgrOf, needsHq, planUnits, repOf, sendUnits, unitSpecs,
  type SendContract, type SendEmployee,
} from "@/components/contracts/bulk-send-core";

const LAST_HQ_KEY = "contractSend.lastHq";   // 최근 고른 본부 담당자 — 이 브라우저의 편의값(없어도 동작)
const readLastHq = () => { try { return localStorage.getItem(LAST_HQ_KEY) || ""; } catch { return ""; } };
const writeLastHq = (v: string) => { try { localStorage.setItem(LAST_HQ_KEY, v); } catch { /* 저장 못 해도 이번 발송은 된다 */ } };

type Row = SendContract & { extraFields?: Record<string, string> | null; salary?: string | null; createdAt?: string };

export default function FlowSendStep({ ids, employees, mainManagerIds, title, stepper, deleteDrafts, onBack, onDone }: {
  ids: string[];
  employees: SendEmployee[];
  mainManagerIds?: Record<string, string>;   // 지점 → 메인 원장 id(단건 발송 창과 같은 원장 고르기)
  deleteDrafts: (ids: string[]) => Promise<boolean>;
  title: string;                 // 보낼 내용 이름(양식·묶음)
  stepper: ReactNode;
  onBack: () => void;            // 초안을 지운 뒤 2단계로
  onDone: () => void;            // 다 보냈을 때
}) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [failed, setFailed] = useState(false);
  // 최근 고른 본부 담당자를 미리 넣는다(지금 목록에 있는 계약 승인 관리자일 때만)
  const [hq, setHq] = useState(() => {
    const last = readLastHq();
    return last && employees.some((e) => e.id === last && e.role === "ADMIN" && e.isContractApprover !== false) ? last : "";
  });
  const [msg, setMsg] = useState("");
  const [days, setDays] = useState("14");
  const [busy, setBusy] = useState(false);

  const idsKey = ids.join(",");
  useEffect(() => {
    let alive = true;
    // 넘겨받은 초안이 없으면 아예 묻지 않는다(빈 ids 로 다른 초안이 딸려 오지 않게 — 검증 F3, 서버도 빈 결과)
    if (!idsKey) { Promise.resolve().then(() => { if (alive) setRows([]); }); return () => { alive = false; }; }
    fetch(`/api/contracts?ids=${encodeURIComponent(idsKey)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!alive) return; if (!d) { setFailed(true); return; } setRows((d.contracts || []).filter((c: Row) => c.status === "DRAFT" || c.status === "REJECTED")); })
      .catch(() => { if (alive) setFailed(true); });
    fetch("/api/admin/contract-message").then((r) => (r.ok ? r.json() : null)).then((d) => { if (alive && d?.message) setMsg((m) => m || d.message); }).catch(() => {});
    return () => { alive = false; };
  }, [idsKey]);

  const admins = employees.filter((e) => e.role === "ADMIN" && e.isContractApprover !== false);

  const contracts = useMemo(() => rows ?? [], [rows]);
  const units = useMemo(() => planUnits(contracts), [contracts]);
  const multiHq = units.filter((u) => isMultiHq(u, contracts));
  const needHq = needsHq(units, contracts);
  const external = contracts.filter((c) => c.externalName);
  // 결재 순서 카드 — 첫 단위의 순서(같은 양식이면 모두 같다). 사람마다 다른 원장은 「자동」으로만 보인다
  // 가장 먼저 만든 사람부터(목록 API 는 최신순) — 첫 번째 사람 기준으로 카드·미리보기를 보인다
  const first = [...units].sort((a, b) => (a.c.createdAt || "").localeCompare(b.c.createdAt || ""))[0];
  const specs = first ? unitSpecs(first, contracts) : [];
  const people = [...new Set(units.map((u) => u.c.userId))];
  const docCount = contracts.length;

  const blockReason = !rows ? "불러오는 중입니다" : !units.length ? "보낼 초안이 없습니다"
    : needHq && !hq ? "1단계 본부 담당자를 고르면 켜져요" : multiHq.length === units.length ? "본부 단계가 둘인 양식은 보낸 계약서에서 각각 보냅니다" : "";

  async function send() {
    if (blockReason) return;
    if (!confirm(`${units.length}건(${people.length}명)을 발송합니다. 발송 후에는 문서를 수정할 수 없습니다. 발송할까요?`)) return;
    setBusy(true);
    try {
      if (hq) writeLastHq(hq);
      const { ok, fail, keep } = await sendUnits(units, (u) => (isMultiHq(u, contracts) ? null : approverIdsOf(u, contracts, employees, hq, mainManagerIds)), {
        message: msg, deadlineDays: Number(days) || 14,
        confirmDup: (dups) => confirm(`같은 양식이 진행 중이거나 30일 안에 보낸 직원이 있습니다:\n${dups.map((u) => `· ${u.c.user.name} — ${u.c.title}`).join("\n")}\n\n이 ${dups.length}건도 발송할까요?`),
      });
      if (fail.length) {
        toast.error(`${ok.length}건 발송, ${fail.length}건 못 보냄: ${fail.join(", ")}`, { duration: 15000 });
        // 못 보낸 것만 남긴다 — 고쳐서 다시 보내거나 「보낸 계약서」에서 각각 보낸다
        setRows((prev) => (prev ?? []).filter((c) => keep.includes(c.id) || (c.bundleId && contracts.some((k) => keep.includes(k.id) && k.bundleId === c.bundleId))));
      } else {
        toast.success(`${ok.length}건을 발송했습니다.`);
        onDone();
      }
    } finally { setBusy(false); }
  }

  async function back() {
    if (busy) return;
    setBusy(true);
    try {
      // 지울 대상은 화면에 불러온 목록이 아니라 넘겨받은 id 를 **지금 다시 확인**해서 고른다(검증 F4) —
      // 아직 「초안」인 것만 지운다. 이미 보낸 것(일부 발송 뒤)은 지우지 않는다(검증 F8)
      let drafts: string[] = [];
      if (ids.length) {
        const r = await fetch(`/api/contracts?ids=${encodeURIComponent(ids.join(","))}`, { cache: "no-store" }).catch(() => null);
        const d = r && r.ok ? await r.json().catch(() => null) : null;
        if (!d) { toast.error("초안 상태를 확인하지 못했습니다. 잠시 뒤 다시 눌러 주세요."); return; }
        drafts = ((d.contracts || []) as Row[]).filter((c) => c.status === "DRAFT").map((c) => c.id);
      }
      const sent = ids.length - drafts.length;
      if (!confirm(`방금 만든 초안 ${drafts.length}건을 지우고 내용 입력으로 돌아갑니다.${sent > 0 ? ` 이미 보낸 ${sent}건은 그대로 둡니다.` : ""} 입력한 값과 받는 사람은 그대로 남습니다. 돌아갈까요?`)) return;
      if (drafts.length && !(await deleteDrafts(drafts))) { toast.error("초안 일부를 지우지 못했습니다. 「보낸 계약서」 목록에서 확인해 주세요."); return; }
      onBack();
    } finally { setBusy(false); }
  }

  const empOf = (id: string) => employees.find((e) => e.id === id);
  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs text-gray-500">전자계약 › 계약서 보내기 › {title}</p>
          <h1 className="text-2xl font-bold text-gray-900">결재자 · 발송</h1>
          <button type="button" onClick={back} disabled={busy} className="mt-1 text-xs text-gray-500 underline hover:text-indigo-600 disabled:opacity-50">← 이전: 내용 입력</button>
        </div>
        {stepper}
      </div>

      {failed ? (
        <p className="rounded-xl border bg-white p-6 text-sm text-red-500">만든 초안을 불러오지 못했습니다. 「보낸 계약서」 목록에서 확인해 주세요.</p>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px] items-start">
          <div className="space-y-5 min-w-0">
            {/* 결재 순서 */}
            <section className="rounded-xl border bg-white p-4">
              <h2 className="font-semibold text-gray-900 mb-3">결재 순서 <span className="text-xs font-normal text-gray-400">· 양식 기본 순서 · 원장·근로자는 자동, 본부만 직접 선택</span></h2>
              <div className="flex flex-col sm:flex-row gap-2 sm:items-stretch">
                {specs.map((s, i) => {
                  const isHq = s.kind === "HQ";
                  const empty = isHq && needHq && !hq;
                  return (
                    <div key={i} className="flex sm:flex-1 items-stretch gap-2">
                      {i > 0 && <span className="hidden sm:flex items-center text-gray-400" aria-hidden>→</span>}
                      <div className={cn("flex-1 rounded-xl border p-3 min-w-0", empty ? "border-red-300 border-dashed bg-red-50/30" : isHq ? "border-indigo-200 bg-white" : "border-indigo-100 bg-indigo-50/40")}>
                        <p className="text-xs text-gray-500">{i + 1}단계 · {KIND_LABEL[s.kind]}</p>
                        {isHq ? (
                          <>
                            <p className={cn("font-bold", empty ? "text-red-600" : "text-gray-900")}>{hq ? empOf(hq)?.name ?? "선택됨" : "선택 필요"}</p>
                            <select value={hq} onChange={(e) => setHq(e.target.value)} className="mt-2 w-full rounded-lg border px-2 py-2 text-sm bg-white">
                              <option value="">본부 담당자 고르기</option>
                              {admins.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                            </select>
                          </>
                        ) : s.kind === "MANAGER" ? (
                          <>
                            <p className="font-bold text-gray-900 truncate">{first && mgrOf(first.c, employees, mainManagerIds) ? (people.length > 1 ? `${mgrOf(first.c, employees, mainManagerIds)!.name} 외` : mgrOf(first.c, employees, mainManagerIds)!.name) : "지점 원장"}</p>
                            <p className="text-xs text-gray-500 mt-1">자동 · 각자 지점 메인 원장</p>
                          </>
                        ) : (
                          <>
                            <p className="font-bold text-gray-900 truncate">{first ? (people.length > 1 ? `${first.c.user.name} 외 ${people.length - 1}명` : first.c.user.name) : "근로자"}</p>
                            <p className="text-xs text-gray-500 mt-1">자동 · 서명 전 비밀번호 확인</p>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              {multiHq.length > 0 && <p className="mt-3 text-xs text-amber-700 bg-amber-50 rounded px-2 py-1">본부 단계가 둘 이상인 양식 {multiHq.length}건은 여기서 못 보냅니다 — 「보낸 계약서」에서 각각 보내 주세요.</p>}
              {units.some((u) => !u.c.employeeOnly && !mgrOf(u.c, employees, mainManagerIds)) && <p className="mt-2 text-xs text-amber-700 bg-amber-50 rounded px-2 py-1">지점 원장을 찾지 못한 건은 원장 단계 없이 보냅니다.</p>}
            </section>

            {/* 보낼 문서 */}
            <section className="rounded-xl border bg-white p-4">
              <h2 className="font-semibold text-gray-900 mb-3">보낼 문서 <span className="text-xs font-normal text-gray-400">· {people.length}명 · 문서 {docCount}건</span></h2>
              {!rows ? <p className="text-sm text-gray-400">불러오는 중…</p> : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="text-left text-xs text-gray-500 border-b"><th className="py-2 pr-3">직원</th><th className="py-2 pr-3">문서</th><th className="py-2 pr-3">결재</th></tr></thead>
                    <tbody>
                      {units.map((u) => {
                        const docs = u.bundle ? contracts.filter((c) => c.bundleId === u.c.bundleId) : [u.c];
                        const m = mgrOf(u.c, employees, mainManagerIds);
                        return (
                          <tr key={u.key} className="border-b last:border-b-0 align-top">
                            <td className="py-2 pr-3 whitespace-nowrap"><b>{u.c.user.name}</b>{u.c.user.branch ? <span className="text-xs text-gray-500"> · {u.c.user.branch}</span> : null}</td>
                            <td className="py-2 pr-3">{docs.map((d) => <div key={d.id} className="text-gray-700">{d.title}</div>)}</td>
                            <td className="py-2 pr-3 text-xs text-gray-500 whitespace-nowrap">
                              {isMultiHq(u, contracts) ? <span className="text-amber-700">개별 발송</span>
                                : unitSpecs(u, contracts).map((s) => (s.kind === "HQ" ? (hq ? empOf(hq)?.name : "본부") : s.kind === "MANAGER" ? (m?.name ?? "원장 없음") : s.kind === "EMPLOYEE" ? u.c.user.name : KIND_LABEL[s.kind])).join(" → ")}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              {external.length > 0 && <p className="mt-2 text-xs text-gray-500">외부 계약 {external.length}건은 서명 링크 전달이 따로라 「보낸 계약서」에서 보냅니다.</p>}
            </section>

            {/* 알림 */}
            <section className="rounded-xl border bg-white p-4 space-y-3">
              <h2 className="font-semibold text-gray-900">알림</h2>
              <p className="text-sm text-gray-700">☑ 받는 사람에게 큐브티 앱·메일로 서명 요청 · 결재 완료 시 본부에 알림</p>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                서명 기한
                <input type="number" min={1} max={90} value={days} onChange={(e) => setDays(e.target.value)} className="w-16 rounded-md border px-2 py-1 text-sm" />일
                <span className="text-xs text-gray-400">· 지나면 자동 만료, 미서명 알림 3일마다</span>
              </label>
              <div>
                <span className="text-xs font-medium text-gray-600">발송 메시지 <span className="font-normal text-gray-400">(선택 · 알림·메일·서명 화면)</span></span>
                <textarea value={msg} onChange={(e) => setMsg(e.target.value)} maxLength={500} rows={2} className="mt-1 w-full rounded-md border px-2 py-1.5 text-sm resize-none" />
              </div>
            </section>
          </div>

          {/* 오른쪽 — 보낼 내용·미리보기·발송 */}
          <aside className="space-y-3 lg:sticky lg:top-4">
            <div className="rounded-xl border bg-white p-4">
              <p className="text-[11px] text-gray-500">보낼 내용</p>
              <p className="font-bold text-gray-900 break-keep">{title}</p>
              <p className="text-xs text-gray-500">{people.length}명 · 문서 {docCount}건</p>
            </div>
            {first && (
              <a href={`/api/contracts/${repOf(first, contracts).id}/original-document?inline=1`} target="_blank" rel="noreferrer"
                className="flex items-center justify-center gap-1.5 rounded-xl border bg-white py-3 text-sm font-semibold text-gray-800 hover:bg-gray-50">
                <Eye size={15} />미리보기 (PDF · 첫 번째 사람)
              </a>
            )}
            <button type="button" onClick={send} disabled={busy || !!blockReason}
              className="w-full rounded-xl bg-indigo-600 py-3.5 text-sm font-bold text-white hover:bg-indigo-700 disabled:bg-gray-200 disabled:text-gray-500">
              {busy ? "보내는 중…" : `발송하기${units.length ? ` (${units.length}건)` : ""}`}
            </button>
            {blockReason && <p className="text-center text-xs text-red-500">{blockReason}</p>}
          </aside>
        </div>
      )}
    </div>
  );
}

