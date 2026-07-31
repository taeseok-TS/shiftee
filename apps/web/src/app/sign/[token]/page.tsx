"use client";

// 외부(미가입) 계약자 게스트 서명 페이지 — 로그인 없이 링크 토큰으로 문서 확인 + 서명
import { use, useEffect, useRef, useState } from "react";
import { SignaturePad, type SignaturePadHandle } from "@/components/SignaturePad";

type Info = { title: string; externalName: string | null; fileUrl: string | null; state: "ready" | "waiting" | "done" | "expired" | "rejected" };

export default function ExternalSignPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [finished, setFinished] = useState(false);
  const sigRef = useRef<SignaturePadHandle>(null);

  useEffect(() => {
    fetch(`/api/contracts/external-sign/${token}`)
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) { setError(d.error || "링크를 확인할 수 없습니다."); return; }
        setInfo(d);
      })
      .catch(() => setError("네트워크 오류가 발생했습니다."));
  }, [token]);

  async function submit() {
    if (!sigRef.current || sigRef.current.isEmpty()) { alert("서명을 입력해주세요."); return; }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/contracts/external-sign/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signatureData: sigRef.current.toDataURL() }),
      });
      const d = await res.json();
      if (!res.ok) { alert(d.error || "서명 처리에 실패했습니다."); return; }
      setFinished(true);
    } finally { setSubmitting(false); }
  }

  // 문서는 서명 차례(ready)일 때만 서버가 내려줌 — 그 외 상태는 안내문만 표시
  const viewerSrc = info?.fileUrl ? `/docs/viewer?src=${encodeURIComponent(info.fileUrl)}` : "";

  return (
    <div className="min-h-screen bg-gray-100">
      <div className="max-w-3xl mx-auto p-4 sm:p-6 space-y-4">
        <div className="bg-white rounded-xl shadow-sm border p-4">
          <p className="text-xs text-gray-400">큐브티 전자계약</p>
          <h1 className="text-lg font-bold mt-0.5">{info?.title || "전자계약 서명"}</h1>
          {info?.externalName && <p className="text-sm text-gray-500 mt-0.5">서명자: {info.externalName}</p>}
        </div>

        {error && (
          <div className="bg-white rounded-xl border p-6 text-center text-red-500 text-sm">{error}</div>
        )}

        {info && !error && (
          <>
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
            ) : (
              <div className="bg-white rounded-xl shadow-sm border p-4 space-y-3">
                <p className="text-sm font-semibold">계약서 내용을 확인하셨다면 아래에 서명해주세요</p>
                <SignaturePad ref={sigRef} />
                <div className="flex gap-2 justify-end">
                  <button type="button" onClick={() => sigRef.current?.clear()}
                    className="px-4 py-2 text-sm border rounded-lg text-gray-600">지우기</button>
                  <button type="button" onClick={submit} disabled={submitting}
                    className="px-5 py-2 text-sm rounded-lg bg-indigo-600 text-white font-medium disabled:opacity-50">
                    {submitting ? "제출 중..." : "서명 제출"}
                  </button>
                </div>
                <p className="text-[11px] text-gray-400">서명 제출 시 본 계약 내용에 동의하는 것으로 간주됩니다.</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
