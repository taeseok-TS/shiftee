"use client";

// 원장 승인·서명 전체 창(2026-10-20 본부 박정인 시안 v2 6번, 첨부 4).
// 작은 팝업 대신 전체 창 — 왼쪽 쪽 목록, 가운데 A4 한 쪽씩, 오른쪽 승인 정보(누가 쓰는 계약인가 · 계약 핵심 값 · 진행 상황 · 서명).
// · 마지막 쪽까지 넘겨 봐야 「서명하고 승인」이 켜진다(읽은 쪽 k/n).
// · 마지막 쪽 아래 서명란 — 결재 단계마다 한 줄, 끝난 칸은 ✓·시각, **내 차례 칸만 점선 「여기를 눌러 서명」**.
//   앞 사람 서명 그림은 문서(서명 반영본)에 이미 찍혀 있다 — 남의 서명 PNG 는 화면에 내려 주지 않는다(위조 방지, my-approvals).
// · 서명 방식은 「서명하기」(손으로 그리기) 하나 + 저장해 둔 내 서명 불러오기. 비밀번호는 그 아래 한 칸.
// 승인·반려 API 호출은 부모가 한다(onSubmit·onReject) — 화면만 바꾸고 규칙은 그대로.
// 근로자 본인 서명도 이 창을 쓴다(mode="sign", 2026-10-21 본부 이예지 재요청 C): 저장 서명 없이 매번 직접 그리기(#205-2),
// 동의·직접 입력 칸은 부모가 extra 로 넣고 막힌 이유는 extraBlock 으로 알린다. 비밀번호는 문서를 열 때 확인했으면 다시 묻지 않는다(pwNeeded).
import { ReauthPasswordInput } from "@/components/ui/reauth-password-input";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { SignaturePad, type SignaturePadHandle } from "@/components/SignaturePad";
import PagedPdfViewer from "@/components/contracts/PagedPdfViewer";
import { cn } from "@/lib/utils";

export type FullViewStep = {
  id: string; order: number; status: string; approverId: string | null; decidedAt?: string | null;
  approver?: { id: string; name: string; branch?: string | null; role?: string | null } | null; externalName?: string | null;
};
export type FullViewContract = {
  id: string; title: string; userId: string; externalName?: string | null; sendMessage?: string | null;
  user: { name: string; branch: string | null; empNo?: number | null };
  docLabel: string;                                    // 서류 이름(양식 종류)
  period?: string | null;                              // 계약 기간(요약 칸에 없을 수 있어 따로)
  summaryFields?: Record<string, string> | null;
  steps: FullViewStep[];
};
export type SignPayload = { signatureData?: string; useSaved?: boolean; saveAsDefault: boolean; password: string };

const kst = (iso?: string | null) => {
  if (!iso) return "";
  const k = new Date(new Date(iso).getTime() + 9 * 3600_000);
  return `${k.getUTCMonth() + 1}/${k.getUTCDate()} ${String(k.getUTCHours()).padStart(2, "0")}:${String(k.getUTCMinutes()).padStart(2, "0")}`;
};

export default function ApprovalFullView({ c, myId, myRole, docUrl, docErr, docIsProgress, hasFile, mySignatureUrl, busy, paused, onSubmit, onReject, onClose,
  mode = "approve", extra, extraBlock, pwNeeded = true, rejectLabel = "반려" }: {
  c: FullViewContract;
  myId: string;
  myRole: string;                    // 내 단계 이름(「원장」)
  docUrl: string | null;             // 정상 PDF 로 받은 본문(blob:). 없으면 불러오는 중이거나 파일 없는 옛 계약
  docErr: string | null;
  docIsProgress: boolean;
  hasFile: boolean;                  // 본문 파일이 있는 계약인가(없는 옛 계약은 요약만으로 승인 — 종전과 같음)
  mySignatureUrl: string | null;
  busy: boolean;
  paused?: boolean;                  // 위에 반려 창이 떠 있음(키보드 쪽 넘김 멈춤)
  onSubmit: (p: SignPayload) => void;
  onReject: () => void;
  onClose: () => void;
  mode?: "approve" | "sign";         // sign = 근로자 본인 서명(저장 서명 없음·「서명하고 제출」)
  extra?: ReactNode;                 // 서명 위에 넣을 부모의 칸(동의·주소·직접 입력·전자서명 동의)
  extraBlock?: string | null;        // 부모 칸 때문에 아직 못 내는 이유
  pwNeeded?: boolean;                // 비밀번호 칸을 보일까(문서를 열 때 확인했으면 false)
  rejectLabel?: string;
}) {
  const signMode = mode === "sign";
  const [visited, setVisited] = useState<Set<number>>(() => new Set());
  const [total, setTotal] = useState(0);
  const [sig, setSig] = useState<{ data?: string; saved?: boolean } | null>(null);
  const [saveAsDefault, setSaveAsDefault] = useState(false);
  const [padOpen, setPadOpen] = useState(false);
  const [pw, setPw] = useState("");
  const padRef = useRef<SignaturePadHandle>(null);

  const read = useMemo(() => (total ? visited.size : 0), [visited, total]);
  // 마지막 쪽까지 넘겨 봐야 승인. 파일이 없는 옛 계약은 읽을 쪽이 없어 요약만으로(종전과 같음)
  const readOk = !hasFile || (!!docUrl && total > 0 && read >= total);
  const canSubmit = !busy && readOk && !extraBlock && !!sig && (!pwNeeded || !!pw);
  const why = hasFile && !docUrl ? (docErr ? `본문을 열지 못해 ${signMode ? "서명" : "승인"}할 수 없습니다` : "본문을 불러오는 중입니다")
    : hasFile && !total ? "본문을 여는 중입니다"
    : !readOk ? `마지막 쪽까지 넘겨 봐 주세요 (${read} / ${total}쪽)`
    : extraBlock ? extraBlock
    : !sig ? "서명란을 눌러 서명해 주세요" : pwNeeded && !pw ? "비밀번호를 넣어 주세요" : "";

  // 다른 사람 단계 — 결재자 역할로(관리자 = 본부, 원장 = 원장, 그 밖 = 결재자: 원장대행 직원 등)
  const roleOf = (s: FullViewStep) => s.approverId === myId ? myRole : s.approverId && s.approverId === c.userId && !c.externalName ? "근로자" : !s.approverId ? "외부 계약자"
    : s.approver?.role === "ADMIN" ? "본부" : s.approver?.role === "MANAGER" ? "원장" : "결재자";
  const nameOf = (s: FullViewStep) => s.approver?.name || s.externalName || (s.approverId === c.userId ? c.user.name : "");
  const mine = c.steps.find((s) => s.approverId === myId && s.status === "PENDING");

  const signStrip = (
    <div className="rounded-lg border bg-white px-5 py-3 shadow-sm">
      <p className="mb-1 text-xs font-semibold text-gray-500">서명란</p>
      {c.steps.map((s) => {
        const isMine = s.id === mine?.id;
        const done = s.status === "APPROVED";
        return (
          <div key={s.id} className="flex items-center gap-3 border-t py-3 first:border-t-0">
            <span className="w-20 shrink-0 text-sm text-gray-500">{roleOf(s)}</span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-gray-900">{nameOf(s)}</p>
              <p className="text-xs text-gray-500">{done ? `${kst(s.decidedAt)} 서명 완료` : isMine ? "지금 서명할 차례" : "대기"}</p>
            </div>
            {isMine ? (
              <button type="button" onClick={() => setPadOpen(true)} disabled={busy}
                className={cn("flex h-16 w-44 shrink-0 items-center justify-center rounded-lg text-sm font-semibold", sig ? "border bg-white" : "border-2 border-dashed border-indigo-500 bg-indigo-50/60 text-indigo-700 hover:bg-indigo-50")}>
                {sig?.data ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={sig.data} alt="내 서명" className="max-h-14 object-contain" />
                ) : sig?.saved && mySignatureUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={mySignatureUrl} alt="저장된 내 서명" className="max-h-14 object-contain" />
                ) : "여기를 눌러 서명"}
              </button>
            ) : (
              <span className={cn("flex h-16 w-44 shrink-0 items-center justify-center rounded-lg border text-xs", done ? "text-indigo-700" : "text-gray-400")}>{done ? (docIsProgress ? "✓ 서명됨 (문서에 반영)" : "✓ 서명됨") : "—"}</span>
            )}
          </div>
        );
      })}
    </div>
  );

  const card = "rounded-xl border bg-white p-4";
  const row = (k: string, v: React.ReactNode) => (
    <div key={k} className="flex justify-between gap-3 text-xs"><span className="text-gray-500">{k}</span><span className="text-right font-semibold text-gray-900">{v}</span></div>
  );
  return (
    <div className="fixed inset-0 z-[45] flex flex-col bg-white" role="dialog" aria-modal="true" aria-label={signMode ? "내 서명" : `${myRole} 승인`}>
      <div className="flex items-center gap-3 border-b px-4 py-3">
        <h1 className="min-w-0 truncate text-lg font-bold text-gray-900">{signMode ? "내 서명" : `${myRole} 승인`} · {c.title}</h1>
        <span className="hidden md:inline truncate text-xs text-gray-500">
          결재 {c.steps.length}단계 · {c.steps.map((s) => `${roleOf(s)}${s.status === "APPROVED" ? " ✓" : s.id === mine?.id ? " (지금)" : ""}`).join(" → ")}
        </span>
        <button type="button" onClick={onClose} className="ml-auto inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"><X size={15} />닫기</button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
        <div className="h-[78vh] min-w-0 shrink-0 lg:h-auto lg:min-h-0 lg:flex-1 lg:shrink">
          {docUrl ? (
            <PagedPdfViewer url={docUrl} visited={visited} lastPageFooter={mine ? signStrip : undefined} paused={padOpen || paused}
              hint={docIsProgress ? "지금까지의 서명 반영본 · 키보드 ← → 로 넘기기" : undefined}
              onPage={(_, n) => setTotal(n)}
              onRendered={(p) => setVisited((v) => (v.has(p) ? v : new Set(v).add(p)))} />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center text-sm">
              {!hasFile ? <><span className="text-gray-500">본문 파일이 없는 계약입니다 — 오른쪽 요약을 보고 승인합니다.</span>{mine && <div className="w-full max-w-[720px] text-left">{signStrip}</div>}</> : docErr ? <span className="text-red-600">{docErr} 본부에 알려 주세요.</span> : <span className="text-gray-400">본문을 불러오는 중입니다…</span>}
            </div>
          )}
        </div>
        {/* 오른쪽 승인 정보 — 제목은 크게, 값은 작게 */}
        <aside className="flex w-full shrink-0 flex-col gap-3 border-t bg-slate-50 p-4 lg:w-[340px] lg:overflow-y-auto lg:border-l lg:border-t-0">
          <section className={card}>
            <h2 className="mb-2 border-b pb-2 text-base font-bold text-gray-900">누가 쓰는 계약인가</h2>
            <div className="space-y-1.5">
              {row(c.externalName ? "계약자" : "직원", c.externalName ? `${c.externalName} (외부)` : c.user.name)}
              {!c.externalName && row("지점 · 사번", [c.user.branch, c.user.empNo ? String(c.user.empNo).padStart(5, "0") : null].filter(Boolean).join(" · ") || "—")}
              {row("서류", c.docLabel)}
              {c.period && row("계약 기간", c.period)}
            </div>
            {c.sendMessage && <p className="mt-2 rounded bg-indigo-50 px-2 py-1.5 text-xs text-indigo-800 whitespace-pre-wrap">본부 메시지 · {c.sendMessage}</p>}
          </section>
          {!!Object.keys(c.summaryFields || {}).length && (
            <section className={card}>
              <h2 className="mb-2 border-b pb-2 text-base font-bold text-gray-900">계약 핵심 값</h2>
              <div className="space-y-1.5">{Object.entries(c.summaryFields || {}).map(([k, v]) => row(k, v))}</div>
            </section>
          )}
          <section className={card}>
            <h2 className="mb-2 border-b pb-2 text-base font-bold text-gray-900">진행 상황</h2>
            <div className="h-1.5 overflow-hidden rounded-full bg-gray-200"><div className="h-full bg-indigo-600 transition-all" style={{ width: `${total ? Math.round((read / total) * 100) : 0}%` }} /></div>
            <p className="mt-1.5 text-xs text-gray-500">{!hasFile ? "본문 파일 없음 · 요약으로 확인" : total ? `${read} / ${total}쪽 ${readOk ? "다 읽었어요 · 이제 서명할 수 있어요" : "읽었어요"}` : "본문을 여는 중"}</p>
            <div className="mt-2 space-y-1.5">
              {c.steps.map((s) => row(`${roleOf(s)} ${nameOf(s)}`,
                s.status === "APPROVED" ? <span className="text-indigo-600">✓ {kst(s.decidedAt)}</span>
                  : s.id === mine?.id ? <span className="text-indigo-600">● 지금 차례</span>
                  : <span className="font-normal text-gray-400">대기</span>))}
            </div>
          </section>
          {extra}
          <section className="mt-auto space-y-2 pt-2">
            <h2 className="border-b pb-2 text-base font-bold text-gray-900">서명</h2>
            <p className="text-xs text-gray-500">계약서 마지막 쪽 서명란을 눌러 서명합니다</p>
            {pwNeeded && (<>
              <ReauthPasswordInput plain value={pw} onChange={(e) => setPw(e.target.value)} placeholder="서명 비밀번호"
                className="w-full rounded-xl border bg-white px-3 py-2.5 text-sm" aria-label="서명 비밀번호(로그인 비밀번호)" />
              <p className="text-[11px] text-gray-500">큐브티 로그인 비밀번호를 한 번 더 넣습니다</p>
            </>)}
            <button type="button" disabled={!canSubmit}
              onClick={() => sig && onSubmit({ ...(sig.saved ? { useSaved: true } : { signatureData: sig.data }), saveAsDefault: !signMode && !sig.saved && saveAsDefault, password: pwNeeded ? pw : "" })}
              className="w-full rounded-xl bg-indigo-600 py-3 text-sm font-bold text-white hover:bg-indigo-700 disabled:bg-gray-200 disabled:text-gray-500">
              {busy ? "처리 중…" : signMode ? "서명하고 제출" : "서명하고 승인"}
            </button>
            {why && <p className="text-center text-xs text-red-500">{why}</p>}
            <button type="button" onClick={onReject} disabled={busy} className="w-full rounded-xl border bg-white py-2.5 text-sm text-gray-700 hover:bg-gray-50">{rejectLabel}</button>
            <button type="button" onClick={onClose} disabled={busy} className="w-full text-center text-xs text-gray-500 underline">나중에 하기</button>
          </section>
        </aside>
      </div>

      {/* 서명하기 — 손으로 그리기 하나(저장해 둔 내 서명은 불러오기) */}
      {padOpen && (
        <div className="fixed inset-0 z-[46] flex items-center justify-center bg-black/40 p-4" onClick={() => setPadOpen(false)}>
          <div className="w-full max-w-lg space-y-3 rounded-2xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
            <p className="font-bold text-gray-900">서명하기</p>
            <SignaturePad ref={padRef} height={180} />
            {/* 근로자 본인 서명은 매번 직접(#205-2) — 저장·불러오기를 두지 않는다 */}
            {!signMode && (
              <label className="flex items-center gap-2 text-xs text-gray-600">
                <input type="checkbox" checked={saveAsDefault} onChange={(e) => setSaveAsDefault(e.target.checked)} />이 서명을 저장해 두고 다음에도 쓰기
              </label>
            )}
            <div className="flex flex-wrap justify-end gap-2">
              {mySignatureUrl && !signMode && <button type="button" onClick={() => { setSig({ saved: true }); setPadOpen(false); }} className="mr-auto rounded-lg border px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">저장해 둔 내 서명 쓰기</button>}
              <button type="button" onClick={() => setPadOpen(false)} className="rounded-lg border px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">취소</button>
              <button type="button" onClick={() => {
                if (!padRef.current || padRef.current.isEmpty()) return;
                setSig({ data: padRef.current.toDataURL() }); setPadOpen(false);
              }} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-bold text-white hover:bg-indigo-700">서명 넣기</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
