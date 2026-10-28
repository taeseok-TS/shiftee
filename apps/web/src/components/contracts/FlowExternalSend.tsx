"use client";
// 계약서 보내기 3단계 — 외부(미가입) 계약자(2026-10-21 본부 이예지 재요청 F: 「같은 3단계 화면에서 보내게」).
// 사내 직원용 3단계(FlowSendStep)와 같은 자리에서, 외부 계약 한 건(또는 외부 채용 패키지 한 묶음)을 보낸다.
// 규칙은 「보낸 계약서」 단건 발송 창(handleSend)과 같다:
//  · 결재 순서는 양식 순서 그대로, 근로자 칸 = 외부 계약자(링크 서명). 본부 = 고른 한 명, 원장 = 고른 한 명(외부는 지점이 없어 자동으로 못 고른다)
//  · 받을 이메일 필수(10/16 이예지 QA 7 — 링크 본인 확인·완료본 PDF), 휴대폰은 2단계에서 받았다(서버가 다시 본다)
//  · 같은 사람에게 같은 양식 중복이면 서버가 409 로 알려 주고, 확인하면 다시 보낸다
//  · 보내면 서명 링크를 보여 준다 — 복사하거나 폰에서는 문자 앱으로(서버가 문자를 보내지는 않는다)
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { KIND_LABEL, DEFAULT_STEPS, parseApprovalSteps, type ApprovalStepSpec } from "@/lib/approval-order";

type Row = {
  id: string; title: string; status: string; bundleId?: string | null; employeeOnly?: boolean; templateId?: string | null; createdAt?: string;
  externalName?: string | null; externalPhone?: string | null; externalEmail?: string | null; approvalSteps?: { kind: string }[] | null;
};
type Emp = { id: string; name: string; role?: string; branch?: string | null; isContractApprover?: boolean };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const smsBody = (name: string, url: string) => `[큐브티 전자계약]\n${name}님, 계약서가 도착했습니다.\n아래 링크에서 내용 확인 후 서명해 주세요.\n${url}`;
function openSmsApp(phone: string, text: string) {
  const num = phone.replace(/[^0-9+]/g, "");
  const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent);
  window.location.href = `sms:${num}${isIos ? "&" : "?"}body=${encodeURIComponent(text)}`;
}

export default function FlowExternalSend({ ids, employees, title, stepper, deleteDrafts, onBack, onDone }: {
  ids: string[];
  employees: Emp[];
  title: string;
  stepper: ReactNode;
  deleteDrafts: (ids: string[]) => Promise<boolean>;
  onBack: () => void;
  onDone: () => void;
}) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [failed, setFailed] = useState(false);
  // 결재 단계마다 고른 사람(양식 순서 그대로) — 본부·원장 단계가 둘 이상인 양식도 칸마다 따로(검증 P1)
  const [picks, setPicks] = useState<Record<number, string>>({});
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState("");
  const [days, setDays] = useState("14");
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<{ url: string; name: string; phone: string | null } | null>(null);

  const idsKey = ids.join(",");
  useEffect(() => {
    let alive = true;
    if (!idsKey) { Promise.resolve().then(() => { if (alive) setRows([]); }); return () => { alive = false; }; }
    fetch(`/api/contracts?ids=${encodeURIComponent(idsKey)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive) return;
        if (!d) { setFailed(true); return; }
        const list = ((d.contracts || []) as Row[]).filter((c) => c.status === "DRAFT" && c.externalName);
        setRows(list);
        const em = list.find((c) => c.externalEmail)?.externalEmail;
        if (em) setEmail((v) => v || em);
      })
      .catch(() => { if (alive) setFailed(true); });
    fetch("/api/admin/contract-message").then((r) => (r.ok ? r.json() : null)).then((d) => { if (alive && d?.message) setMsg((m) => m || d.message); }).catch(() => {});
    return () => { alive = false; };
  }, [idsKey]);

  const contracts = useMemo(() => rows ?? [], [rows]);
  // 한 번에 보내는 것은 외부 계약 하나(또는 그 묶음 하나)
  const bundleId = contracts.find((c) => c.bundleId)?.bundleId ?? null;
  const rep = useMemo(() => {
    const pool = bundleId ? contracts.filter((c) => c.bundleId === bundleId && !c.employeeOnly && c.templateId) : contracts;
    return [...pool].sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || "") || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0] ?? contracts[0];
  }, [contracts, bundleId]);
  const specs: ApprovalStepSpec[] = rep ? (parseApprovalSteps(rep.approvalSteps) ?? DEFAULT_STEPS) : [];
  const admins = employees.filter((e) => e.role === "ADMIN" && e.isContractApprover !== false);
  const managers = employees.filter((e) => e.role === "MANAGER");
  const name = rep?.externalName || "외부 계약자";
  const phone = rep?.externalPhone || null;
  const multi = !bundleId && contracts.length > 1;
  const chosen = specs.map((s, i) => (s.kind === "EMPLOYEE" ? "" : picks[i] || "")).filter(Boolean);
  const dupPick = new Set(chosen).size !== chosen.length;   // 외부 계약 여러 건이 한꺼번에 오는 경로는 없다 — 오면 보낸 계약서에서 각각

  const block = !rows ? "불러오는 중입니다" : !contracts.length ? "보낼 초안이 없습니다" : multi ? "외부 계약이 여러 건입니다 — 보낸 계약서에서 각각 보내 주세요"
    : specs.some((s, i) => s.kind === "HQ" && !picks[i]) ? "본부 담당자를 골라 주세요" : specs.some((s, i) => s.kind === "MANAGER" && !picks[i]) ? "원장을 골라 주세요"
    : dupPick ? "같은 사람을 두 단계에 넣을 수 없습니다 — 단계마다 다른 사람을 골라 주세요"
    : !EMAIL_RE.test(email.trim()) ? "계약서를 받을 이메일을 넣어 주세요" : "";

  // 양식 순서 그대로 — 근로자 칸은 외부 계약자(링크 서명)
  const approverIds = specs.map((s, i) => (s.kind === "EMPLOYEE" || s.kind === "EXTERNAL" ? "EXTERNAL" : picks[i] || "")).filter(Boolean);   // 양식에 「외부 계약자」 단계를 직접 넣은 경우도(재검증)

  async function send() {
    if (block || busy || !rep) return;
    if (!confirm(`${name} 님께 ${bundleId ? `${contracts.length}종 묶음` : "계약서 1건"}을 보냅니다. 발송 후에는 문서를 수정할 수 없습니다.\n\n결재 순서: ${specs.map((s) => (s.kind === "EMPLOYEE" ? "외부 계약자" : KIND_LABEL[s.kind])).join(" → ")}\n받을 이메일: ${email.trim()}\n\n발송할까요?`)) return;
    setBusy(true);
    try {
      const payload: Record<string, unknown> = { approverIds, sendMessage: msg, deadlineDays: Number(days) || 14, externalEmail: email.trim() };
      const url = bundleId ? `/api/contracts/bundle/${bundleId}/send` : `/api/contracts/${rep.id}`;
      const method = bundleId ? "POST" : "PATCH";
      const body = (extra: Record<string, unknown> = {}) => JSON.stringify(bundleId ? { ...payload, ...extra } : { status: "SENT", ...payload, ...extra });
      let res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body() });
      let d = await res.json().catch(() => ({}));
      if (res.status === 409 && d.code === "DUPLICATE") {
        const list = (d.duplicates || []).map((x: { title: string }) => `· ${x.title}`).join("\n");
        if (!confirm(`같은 사람에게 같은 양식을 진행 중이거나 최근 30일 안에 보냈습니다:\n${list}\n\n그래도 보낼까요?`)) return;
        res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body({ confirmDuplicate: true }) });
        d = await res.json().catch(() => ({}));
      }
      if (!res.ok) { toast.error(d.error || "발송하지 못했습니다."); return; }
      // 서명 링크 — 묶음은 서버가 돌려준 토큰, 단건은 외부 단계(결재자 없음)의 토큰
      const token: string | undefined = bundleId ? d.externalSignToken
        : (d.contract?.approvalLine?.steps || []).find((st: { approverId?: string | null; signToken?: string | null }) => !st.approverId && st.signToken)?.signToken;
      toast.success(bundleId ? `문서 ${d.sent ?? contracts.length}건 발송 — 링크 하나로 함께 서명합니다.` : "계약서를 발송했습니다.");
      if (token) setLink({ url: `${window.location.origin}/sign/${token}`, name, phone });
      else onDone();
    } finally { setBusy(false); }
  }

  async function back() {
    if (busy) return;
    if (!confirm(`방금 만든 초안 ${contracts.length || ids.length}건을 지우고 내용 입력으로 돌아갑니다. 입력한 값은 그대로 남습니다. 돌아갈까요?`)) return;
    setBusy(true);
    try {
      if (!(await deleteDrafts(ids))) { toast.error("초안을 지우지 못했습니다. 「보낸 계약서」 목록에서 확인해 주세요."); return; }
      onBack();
    } finally { setBusy(false); }
  }

  const sel = "w-full rounded-lg border bg-white px-3 py-2 text-sm";
  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs text-gray-500">전자계약 › 계약서 보내기 › {title}</p>
          <h1 className="text-2xl font-bold text-gray-900">결재자 · 발송 <span className="text-base font-medium text-gray-500">· 외부 계약자</span></h1>
          {!link && <button type="button" onClick={() => void back()} className="mt-1 text-xs text-gray-500 underline hover:text-indigo-600">← 이전: 내용 입력</button>}
        </div>
        {stepper}
      </div>
      {failed && <p className="text-sm text-red-600">초안을 불러오지 못했습니다. 「보낸 계약서」 목록에서 확인해 주세요.</p>}
      {link ? (
        <div className="max-w-xl space-y-3 rounded-xl border bg-white p-5">
          <p className="text-lg font-bold text-gray-900">발송했습니다 — 서명 링크 전달</p>
          <p className="text-sm text-gray-600"><b>{link.name}</b> 님께 아래 링크를 전달하면 가입 없이 서명할 수 있습니다{link.phone ? ` (${link.phone})` : ""}. 링크를 연 사람은 휴대폰 뒷자리 4자리와 이메일로 본인 확인을 합니다.</p>
          <div className="select-all break-all rounded-md border bg-gray-50 p-2.5 text-xs">{link.url}</div>
          <div className="grid gap-2 sm:grid-cols-2">
            <button type="button" className="rounded-lg bg-indigo-600 py-2.5 text-sm font-bold text-white hover:bg-indigo-700"
              onClick={() => navigator.clipboard.writeText(link.url).then(() => toast.success("링크를 복사했습니다. 카톡·문자에 붙여 넣어 전달하세요.")).catch(() => toast.error("복사하지 못했습니다. 위 주소를 길게 눌러 복사해 주세요."))}>링크 복사</button>
            <button type="button" disabled={!link.phone} className="rounded-lg border bg-white py-2.5 text-sm text-gray-800 hover:bg-gray-50 disabled:opacity-40"
              onClick={() => link.phone && openSmsApp(link.phone, smsBody(link.name, link.url))}>문자로 보내기(폰)</button>
          </div>
          <p className="text-[12px] text-gray-500">문자는 이 기기의 문자 앱으로 열립니다(서버가 자동으로 보내지 않습니다). 링크는 「보낸 계약서」에서 다시 볼 수 있습니다.</p>
          <button type="button" onClick={onDone} className="w-full rounded-lg border bg-white py-2.5 text-sm text-gray-700 hover:bg-gray-50">보낸 계약서로</button>
        </div>
      ) : (
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="space-y-4 rounded-xl border bg-white p-4 sm:p-5">
            <div>
              <p className="text-sm font-semibold text-gray-900">받는 사람</p>
              <p className="text-sm text-gray-700">{name}{phone ? ` · ${phone}` : ""} <span className="text-xs text-gray-500">(큐브티 미가입 — 링크로 서명)</span></p>
              {bundleId && <p className="mt-1 text-xs text-gray-500">{contracts.length}종: {contracts.map((c) => c.title).join(" · ")}</p>}
            </div>
            <label className="block space-y-1">
              <span className="text-sm font-semibold text-gray-900">계약서를 받을 이메일 <span className="text-red-500">*</span></span>
              <input type="email" inputMode="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="예: hong@example.com" className={sel} />
              <span className="block text-[12px] text-gray-500">링크를 열 때 이 이메일로 본인 확인을 하고, 서명이 끝나면 완료본 PDF 가 이 주소로 갑니다.</span>
            </label>
            <div className="space-y-2">
              <p className="text-sm font-semibold text-gray-900">결재 순서 <span className="text-xs font-normal text-gray-500">(양식 순서 그대로)</span></p>
              <ol className="space-y-2">
                {specs.map((s, i) => (
                  <li key={i} className="flex flex-wrap items-center gap-2 rounded-lg border p-2.5">
                    <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-indigo-600 text-xs font-bold text-white">{i + 1}</span>
                    <span className="w-16 text-sm text-gray-700">{s.kind === "EMPLOYEE" ? "외부 계약자" : KIND_LABEL[s.kind]}</span>
                    {s.kind === "HQ" ? (
                      <select value={picks[i] || ""} onChange={(e) => setPicks((p) => ({ ...p, [i]: e.target.value }))} className={`${sel} sm:w-60`} aria-label={`${i + 1}단계 본부 담당자`}>
                        <option value="">본부 담당자 고르기</option>
                        {admins.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                      </select>
                    ) : s.kind === "MANAGER" ? (
                      <select value={picks[i] || ""} onChange={(e) => setPicks((p) => ({ ...p, [i]: e.target.value }))} className={`${sel} sm:w-60`} aria-label={`${i + 1}단계 원장`}>
                        <option value="">원장 고르기</option>
                        {managers.map((m) => <option key={m.id} value={m.id}>{m.name}{m.branch ? ` · ${m.branch}` : ""}</option>)}
                      </select>
                    ) : (
                      <span className="text-sm text-gray-600">{name} — 링크로 서명</span>
                    )}
                  </li>
                ))}
              </ol>
            </div>
            <label className="block space-y-1">
              <span className="text-sm font-semibold text-gray-900">함께 보낼 말 <span className="text-xs font-normal text-gray-500">(선택)</span></span>
              <textarea rows={2} maxLength={500} value={msg} onChange={(e) => setMsg(e.target.value)} className={sel} />
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700">서명 기한
              <select value={days} onChange={(e) => setDays(e.target.value)} className="rounded-lg border bg-white px-2 py-1.5 text-sm">
                {["3", "7", "14", "30"].map((d) => <option key={d} value={d}>{d}일</option>)}
              </select>
            </label>
          </div>
          <aside className="space-y-3 lg:sticky lg:top-4">
            <div className="rounded-xl border bg-white p-4">
              <p className="text-[12px] text-gray-500">보낼 내용</p>
              <p className="break-keep font-bold text-gray-900">{title}</p>
              <p className="text-xs text-gray-500">외부 계약자 1명 · 문서 {contracts.length || "—"}건</p>
            </div>
            <button type="button" onClick={() => void send()} disabled={!!block || busy}
              className="w-full rounded-xl bg-indigo-600 py-3.5 text-sm font-bold text-white hover:bg-indigo-700 disabled:bg-gray-200 disabled:text-gray-500">
              {busy ? "보내는 중…" : "발송"}
            </button>
            {block && <p className="text-center text-xs text-red-500">{block}</p>}
          </aside>
        </div>
      )}
    </div>
  );
}
