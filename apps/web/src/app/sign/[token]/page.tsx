"use client";

// 외부(미가입) 계약자 게스트 서명 페이지 — 로그인 없이 링크 토큰으로 문서 확인 + 서명
// 패키지(계약서+비밀유지서약서+개인정보동의서)면 문서 탭으로 전환하며 확인 후 한 번의 서명으로 함께 서명
import { use, useEffect, useRef, useState } from "react";
import { SignaturePad, type SignaturePadHandle } from "@/components/SignaturePad";
import { SIGN_CONSENT_TEXT } from "@/lib/contract-consent";

type Doc = { title: string; fileUrl: string | null };
type Info = {
  title: string;
  externalName: string | null;
  fileUrl: string | null;
  documents: Doc[];
  consentDoc: boolean;
  state: "ready" | "waiting" | "done" | "expired" | "rejected";
  version?: number; // 문서 버전 — 제출 때 x-doc-version 으로 되돌려 보낸다(#206 검증 F2)
  fileTicket?: string | null; // 게스트 파일 접근 티켓 — 뷰어 URL 에 ?t= 로 부착
  needVerify?: boolean;       // 본인 확인(연락처 뒷자리) 전 — 문서 대신 확인 화면(#205-1)
  phoneHint?: string | null;  // 안내용(앞 3자리만)
};

export default function ExternalSignPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [finished, setFinished] = useState(false);
  const [docIdx, setDocIdx] = useState(0);
  // 개인정보동의서 — 사전 체크 금지(개인정보보호법), 게스트가 직접 선택 (#104, 2026-08-27)
  const [consentRequired, setConsentRequired] = useState(false); // 필수 항목 명시 동의
  const [consentUnique, setConsentUnique] = useState<"" | "동의" | "미동의">("");
  const [consentRecruit, setConsentRecruit] = useState<"" | "동의" | "미동의">("");
  const sigRef = useRef<SignaturePadHandle>(null);
  // 본인 확인(#205-1) — 연락처 뒷자리 4자리를 맞히면 서버가 2시간짜리 증표를 준다. 증표로 다시 불러와야 문서가 열린다.
  const [last4, setLast4] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [verifyToken, setVerifyToken] = useState("");
  const [agree, setAgree] = useState(false); // 전자서명 동의(#205-3) — 명시적으로 체크해야 제출
  const viewedSent = useRef(false);          // 열람 알림은 한 번만(#205-4)

  const load = (vt?: string) =>
    fetch(`/api/contracts/external-sign/${token}`, vt ? { headers: { "x-sign-verify": vt } } : undefined)
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) { setError(d.error || "링크를 확인할 수 없습니다."); return; }
        setInfo(d);
      })
      .catch(() => setError("네트워크 오류가 발생했습니다."));

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // 열람 기록(#205-4) — 문서를 받은 뒤 한 번 알린다(서버는 GET 에 기록을 넣지 않는다)
  useEffect(() => {
    if (viewedSent.current || !info || info.state !== "ready" || info.needVerify) return;
    if (!(info.documents?.length || info.fileUrl)) return;
    viewedSent.current = true;
    fetch(`/api/contracts/external-sign/${token}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "viewed", verifyToken }),
    }).catch(() => {});
  }, [info, token, verifyToken]);

  async function verify() {
    if (!/^\d{4}$/.test(last4)) { alert("연락처 뒷자리 4자리를 입력해주세요."); return; }
    setVerifying(true);
    try {
      const res = await fetch(`/api/contracts/external-sign/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "verify", last4 }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { alert(d.error || "확인에 실패했습니다."); return; }
      setVerifyToken(d.verifyToken);
      await load(d.verifyToken);
    } finally { setVerifying(false); }
  }

  async function submit() {
    if (info?.consentDoc) {
      if (!consentRequired) { alert("필수 항목 동의에 체크해주세요."); return; }
      if (!consentUnique || !consentRecruit) { alert("선택 항목의 동의 여부를 각각 선택해주세요."); return; }
    }
    if (!agree) { alert("전자서명 동의에 체크해주세요."); return; }
    if (!sigRef.current || sigRef.current.isEmpty()) { alert("서명을 입력해주세요."); return; }
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = { signatureData: sigRef.current.toDataURL(), verifyToken, agree: true };
      if (info?.consentDoc) {
        body.consent = {
          동의필수: "동의",
          동의고유식별: consentUnique,
          동의채용정보: consentRecruit,
        };
      }
      const res = await fetch(`/api/contracts/external-sign/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(typeof info?.version === "number" ? { "x-doc-version": String(info.version) } : {}) },
        body: JSON.stringify(body),
      });
      const d = await res.json();
      if (!res.ok) { alert(d.error || "서명 처리에 실패했습니다."); return; }
      if (d.warning) alert(d.warning);
      setFinished(true);
    } finally { setSubmitting(false); }
  }

  // 문서는 서명 차례(ready)일 때만 서버가 내려줌 — 그 외 상태는 안내문만 표시
  const docs: Doc[] = info?.documents?.length ? info.documents : info?.fileUrl ? [{ title: info.title, fileUrl: info.fileUrl }] : [];
  const currentDoc = docs[Math.min(docIdx, Math.max(docs.length - 1, 0))];
  // 게스트는 세션이 없어 파일 접근 티켓을 URL 에 부착 (uploads 게이트와 세트)
  const ticketQs = info?.fileTicket ? `?t=${info.fileTicket}` : "";
  const viewerSrc = currentDoc?.fileUrl ? `/docs/viewer?src=${encodeURIComponent(currentDoc.fileUrl + ticketQs)}` : "";

  return (
    <div className="min-h-screen bg-gray-100">
      <div className="max-w-3xl mx-auto p-4 sm:p-6 space-y-4">
        <div className="bg-white rounded-xl shadow-sm border p-4">
          <p className="text-xs text-gray-400">큐브티 전자계약</p>
          <h1 className="text-lg font-bold mt-0.5">{info?.title || "전자계약 서명"}</h1>
          {info?.externalName && <p className="text-sm text-gray-500 mt-0.5">서명자: {info.externalName}</p>}
          {docs.length > 1 && (
            <p className="text-xs text-violet-600 mt-1">총 {docs.length}건의 문서를 확인 후 한 번의 서명으로 함께 서명합니다.</p>
          )}
        </div>

        {error && (
          <div className="bg-white rounded-xl border p-6 text-center text-red-500 text-sm">{error}</div>
        )}

        {info && !error && (
          <>
            {/* 문서 탭 (패키지) */}
            {docs.length > 1 && (
              <div className="flex gap-2 flex-wrap">
                {docs.map((d, i) => (
                  <button key={i} type="button" onClick={() => setDocIdx(i)}
                    className={`px-3 py-1.5 text-xs rounded-full border ${i === docIdx ? "bg-indigo-600 text-white border-indigo-600" : "bg-white text-gray-600"}`}>
                    {d.title.replace(/ - .*$/, "")}
                  </button>
                ))}
              </div>
            )}

            {/* 문서 뷰어 */}
            {viewerSrc && (
              <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
                <iframe src={viewerSrc} title="계약서" className="w-full border-0" style={{ height: "62vh" }} />
              </div>
            )}

            {finished || info.state === "done" ? (
              <div className="bg-white rounded-xl border p-6 text-center space-y-1">
                <p className="text-2xl">✅</p>
                <p className="font-semibold">서명이 완료되었습니다</p>
                <p className="text-xs text-gray-500">서명된 계약서는 회사에서 보관하며, 필요 시 담당자에게 사본을 요청하실 수 있습니다.</p>
              </div>
            ) : info.state === "rejected" ? (
              <div className="bg-white rounded-xl border p-6 text-center text-sm text-red-500">
                이 계약은 반려되어 진행이 중단되었습니다. 자세한 내용은 담당자에게 문의해주세요.
              </div>
            ) : info.state === "expired" ? (
              <div className="bg-white rounded-xl border p-6 text-center text-sm text-amber-600">
                서명 링크가 만료되었습니다. 담당자에게 재발급을 요청해주세요.
              </div>
            ) : info.state === "waiting" ? (
              <div className="bg-white rounded-xl border p-6 text-center text-sm text-gray-500">
                아직 서명 차례가 아닙니다. 앞 단계 결재가 끝나면 이 링크에서 서명하실 수 있습니다.
              </div>
            ) : info.needVerify ? (
              <div className="bg-white rounded-xl shadow-sm border p-5 space-y-3">
                <p className="text-sm font-semibold">본인 확인</p>
                <p className="text-xs text-gray-500">
                  계약서를 보시기 전에, 담당자가 등록한 연락처{info.phoneHint ? ` (${info.phoneHint})` : ""}의 뒷자리 4자리를 입력해 주세요.
                </p>
                <div className="flex gap-2">
                  <input inputMode="numeric" maxLength={4} value={last4} aria-label="연락처 뒷자리 4자리"
                    onChange={(e) => setLast4(e.target.value.replace(/\D/g, "").slice(0, 4))}
                    onKeyDown={(e) => { if (e.key === "Enter") verify(); }}
                    className="w-32 border rounded-lg px-3 py-2 text-center tracking-widest" placeholder="0000" />
                  <button type="button" onClick={verify} disabled={verifying || last4.length !== 4}
                    className="px-4 py-2 text-sm rounded-lg bg-indigo-600 text-white font-medium disabled:opacity-50">
                    {verifying ? "확인 중..." : "확인"}
                  </button>
                </div>
                <p className="text-[11px] text-gray-400">여러 번 틀리면 잠시 잠깁니다. 번호가 다르면 담당자에게 문의해 주세요.</p>
              </div>
            ) : (
              <div className="bg-white rounded-xl shadow-sm border p-4 space-y-3">
                {info.consentDoc && (
                  <div className="rounded-lg border bg-gray-50 p-3 space-y-2.5">
                    <p className="text-xs font-semibold text-gray-700">개인정보 수집·이용 동의</p>
                    {/* 사전 체크 금지 — 서명자가 직접 선택 (#104) */}
                    <label className="flex items-start gap-2 text-xs text-gray-700 cursor-pointer">
                      <input type="checkbox" className="mt-0.5" checked={consentRequired} onChange={(e) => setConsentRequired(e.target.checked)} />
                      <span><b>[필수]</b> 개인정보 수집·이용, 민감정보, 퇴직 후 보유, 제3자 제공에 동의합니다 (미동의 시 채용이 취소·제한될 수 있습니다)</span>
                    </label>
                    {([["고유식별정보 수집·이용 (선택)", consentUnique, setConsentUnique], ["채용 관련 정보 수신 (선택)", consentRecruit, setConsentRecruit]] as const).map(([label, val, setter]) => (
                      <div key={label} className="text-xs text-gray-600">
                        <p className="mb-1">{label}</p>
                        <div className="flex gap-4">
                          {(["동의", "미동의"] as const).map(opt => (
                            <label key={opt} className="flex items-center gap-1 cursor-pointer">
                              <input type="radio" checked={val === opt} onChange={() => (setter as (v: "동의" | "미동의") => void)(opt)} />{opt}
                            </label>
                          ))}
                        </div>
                      </div>
                    ))}
                    <p className="text-[11px] text-gray-400">위 선택이 개인정보동의서 문서에 반영된 뒤 서명이 적용됩니다.</p>
                  </div>
                )}
                <p className="text-sm font-semibold">
                  {docs.length > 1 ? `문서 ${docs.length}건의 내용을 모두 확인하셨다면 아래에 서명해주세요` : "계약서 내용을 확인하셨다면 아래에 서명해주세요"}
                </p>
                {/* 전자서명 동의(#205-3) — 명시적으로 체크해야 제출된다(종전엔 "제출하면 동의로 간주" 안내뿐) */}
                <label className="flex items-start gap-2 text-xs text-gray-700 cursor-pointer rounded-lg border border-indigo-200 bg-indigo-50 p-2.5">
                  <input type="checkbox" className="mt-0.5" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
                  <span><b>[필수]</b> {SIGN_CONSENT_TEXT}{docs.length > 1 ? ` (위 문서 ${docs.length}건 전체에 서명이 적용됩니다)` : ""}</span>
                </label>
                <SignaturePad ref={sigRef} />
                <div className="flex gap-2 justify-end">
                  <button type="button" onClick={() => sigRef.current?.clear()}
                    className="px-4 py-2 text-sm border rounded-lg text-gray-600">지우기</button>
                  <button type="button" onClick={submit} disabled={submitting}
                    className="px-5 py-2 text-sm rounded-lg bg-indigo-600 text-white font-medium disabled:opacity-50">
                    {submitting ? "제출 중..." : "서명 제출"}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
