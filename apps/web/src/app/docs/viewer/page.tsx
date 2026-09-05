"use client";

// 계약서 인앱 뷰어 — 서버(LibreOffice) 변환 PDF 를 그대로 보여준다.
//
// 이전에는 브라우저에서 docx-preview 로 직접 그렸는데, 발송·다운로드에 쓰는
// LibreOffice 렌더와 결과가 달라(로고 누락·정렬 깨짐·글꼴 차이) "화면마다 문서가 다르다"는
// 문제가 반복됐다 (QA 2026-08-27 이예지대리 #153~#157·#162·#163).
// 이제 목록·서명·발송 미리보기·다운로드가 전부 같은 PDF 한 벌을 본다.
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

function DocViewer() {
  const params = useSearchParams();
  const src = params.get("src") || "";
  const title = params.get("title") || "";
  const [error, setError] = useState("");
  const [pdfUrl, setPdfUrl] = useState("");

  useEffect(() => {
    if (!src) { setError("문서 주소가 없습니다."); return; }
    // src 에 이미 티켓(?t=)이 붙어 있으면 분리해서 변환 라우트로 넘긴다 (게스트·앱 경로)
    const [rawSrc, query] = src.split("?");
    const t = new URLSearchParams(query || "").get("t");
    // ⚠ 앱은 fileUri() 로 **절대 URL**(https://cubetee.co.kr/api/uploads/…)을 넘긴다. 그걸 그대로
    //   /api/docs/pdf?src= 에 주면 그 라우트의 "/api/uploads/… 상대경로만" 검사에 걸려 400 이
    //   나고, 앱의 "계약서 보기"가 통째로 "잘못된 문서 경로입니다" 로 죽어 있었다
    //   (2026-09-05 실기기에서 발견 — 유효 티켓으로 상대경로 200 / 절대경로 400 실측).
    //   우리 오리진이면 오리진을 떼고 상대경로로 낮춘다. 남의 오리진은 손대지 않는다(라우트가 거른다).
    const own = typeof window !== "undefined" ? window.location.origin : "";
    const rawPath = own && rawSrc.startsWith(own + "/") ? rawSrc.slice(own.length) : rawSrc;
    if (/\.pdf$/i.test(rawPath)) {
      // 이미 PDF 면 그대로 (변환 불필요)
      setPdfUrl(src);
      return;
    }
    const qs = new URLSearchParams({ src: rawPath });
    if (t) qs.set("t", t);
    if (title) qs.set("title", title);
    setPdfUrl(`/api/docs/pdf?${qs.toString()}`);
  }, [src, title]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 text-center text-sm text-red-500">
        {error}
      </div>
    );
  }
  if (!pdfUrl) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-gray-400">
        문서를 불러오는 중…
      </div>
    );
  }
  return (
    <iframe
      src={pdfUrl}
      title="문서 보기"
      className="w-full border-0"
      style={{ height: "100vh", display: "block" }}
      onError={() => setError("문서를 여는 중 오류가 발생했습니다.")}
    />
  );
}

export default function DocViewerPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-sm text-gray-400">문서를 불러오는 중…</div>}>
      <DocViewer />
    </Suspense>
  );
}
