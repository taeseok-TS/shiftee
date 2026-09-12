"use client";

// 완료본 진위 확인 페이지(#205-5) — 로그인 없이 문서번호로. 파일은 서버로 보내지 않고 이 브라우저 안에서 SHA-256 을 계산해 대조한다.
import { use, useEffect, useState } from "react";
import { tsaName } from "@/lib/tsa-label";

type Info = { found: boolean; docNo?: string; sha256?: string; completedAt?: string | null; frozenAt?: string | null; signerCount?: number;
  tsa?: { at: string; url: string | null } | null };

const kst = (s?: string | null) =>
  s ? new Date(new Date(s).getTime() + 9 * 3600 * 1000).toISOString().slice(0, 16).replace("T", " ") + " (KST)" : "-";

export default function VerifyPage({ params }: { params: Promise<{ docNo: string }> }) {
  const { docNo } = use(params);
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState("");
  const [result, setResult] = useState<"" | "match" | "mismatch">("");
  const [fileHash, setFileHash] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch(`/api/verify/${encodeURIComponent(docNo)}`)
      .then(async (r) => setInfo((await r.json().catch(() => ({ found: false }))) as Info))
      .catch(() => setError("확인 정보를 불러오지 못했습니다. 잠시 후 다시 열어 주세요."));
  }, [docNo]);

  const check = async (f: File | undefined) => {
    if (!f || !info?.sha256) return;
    setBusy(true); setResult(""); setFileHash("");
    try {
      const d = await crypto.subtle.digest("SHA-256", await f.arrayBuffer());
      const hex = Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, "0")).join("");
      setFileHash(hex);
      setResult(hex === info.sha256 ? "match" : "mismatch");
    } catch {
      setError("파일을 읽지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex justify-center px-4 py-10">
      <div className="w-full max-w-lg space-y-4">
        <h1 className="text-xl font-bold text-gray-900">전자계약 완료본 진위 확인</h1>
        <p className="text-sm text-gray-500">문서번호 <span className="font-mono text-gray-800">{docNo}</span></p>
        {error && <p className="text-sm text-red-600">{error}</p>}
        {!info && !error && <p className="text-sm text-gray-400">확인 중…</p>}
        {info && !info.found && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            이 문서번호로 발급된 유효한 완료본이 없습니다. 결재가 회수된 뒤 다시 서명된 문서는 새 문서번호가 붙습니다.
          </div>
        )}
        {info?.found && (
          <>
            <div className="rounded-lg border bg-white p-4 text-sm space-y-1.5">
              <p><span className="text-gray-500">상태</span> <b className="text-green-700">완료된 계약의 발급 완료본</b></p>
              <p><span className="text-gray-500">계약 완료</span> {kst(info.completedAt)}</p>
              <p><span className="text-gray-500">완료본 고정</span> {kst(info.frozenAt)}</p>
              <p><span className="text-gray-500">서명</span> {info.signerCount}명</p>
              {/* 제3자 시각 인증(TSA) — 우리 서버 밖 기관이 이 해시가 그 시각에 있었음을 서명했다 */}
              <p>
                <span className="text-gray-500">제3자 시각 인증</span>{" "}
                {info.tsa ? (
                  <>
                    {tsaName(info.tsa.url)} · {kst(info.tsa.at)}{" "}
                    <a href={`/api/verify/${encodeURIComponent(docNo)}/tsr`} className="text-indigo-600 underline">도장 파일 받기</a>
                  </>
                ) : <span className="text-gray-400">받는 중(잠시 뒤 붙습니다 — 보통 1시간 안)</span>}
              </p>
              <p className="text-gray-500">SHA-256</p>
              <p className="font-mono text-xs break-all text-gray-800">{info.sha256}</p>
            </div>
            <div className="rounded-lg border bg-white p-4 space-y-2">
              <p className="text-sm font-medium text-gray-800">가지고 계신 PDF 파일로 확인</p>
              <input type="file" accept="application/pdf,.pdf" disabled={busy}
                onChange={(e) => check(e.target.files?.[0])} className="block w-full text-sm" />
              <p className="text-[11px] text-gray-400">파일은 서버로 전송되지 않고 이 브라우저 안에서만 계산합니다.</p>
              {busy && <p className="text-sm text-gray-400">계산 중…</p>}
              {result === "match" && (
                <p className="rounded bg-green-50 border border-green-200 p-2 text-sm text-green-800">
                  일치 — 발급한 완료본 원본과 같은 파일입니다.
                </p>
              )}
              {result === "mismatch" && (
                <div className="rounded bg-red-50 border border-red-200 p-2 text-sm text-red-700 space-y-1">
                  <p>불일치 — 발급 원본과 다른 파일입니다(내용이 바뀌었거나 다른 문서입니다).</p>
                  <p className="font-mono text-[11px] break-all">이 파일: {fileHash}</p>
                </div>
              )}
            </div>
          </>
        )}
        <p className="text-[11px] text-gray-400">큐브티 전자계약</p>
      </div>
    </div>
  );
}
