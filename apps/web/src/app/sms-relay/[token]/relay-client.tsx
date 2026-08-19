"use client";

import { useEffect, useState } from "react";

// 문자 앱을 수신번호·본문이 채워진 채로 연다. 발송은 이 폰의 번호(요금제)로 나간다.
export default function SmsRelayClient({
  phone, name, title, signUrl, signed,
}: { phone: string; name: string; title: string; signUrl: string; signed: boolean }) {
  const [smsHref, setSmsHref] = useState("");

  const fullSignUrl = typeof window !== "undefined" ? `${window.location.origin}${signUrl}` : signUrl;

  useEffect(() => {
    if (!phone || signed) return;
    const num = phone.replace(/[^0-9+]/g, "");
    const body = `[큐브티 전자계약]\n${name}님, 계약서가 도착했습니다.\n아래 링크에서 내용 확인 후 서명해 주세요.\n${window.location.origin}${signUrl}`;
    const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const href = `sms:${num}${isIos ? "&" : "?"}body=${encodeURIComponent(body)}`;
    setSmsHref(href);
    // 바로 문자 앱으로 — 팝업 차단 등으로 안 열리면 아래 버튼이 받쳐준다
    window.location.href = href;
  }, [phone, name, signUrl, signed]);

  if (signed) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
        <div className="text-center space-y-2">
          <p className="text-lg font-semibold text-emerald-700">이미 서명이 완료된 계약입니다</p>
          <p className="text-sm text-gray-500">{title}</p>
        </div>
      </div>
    );
  }

  if (!phone) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
        <div className="text-center space-y-3 max-w-sm">
          <p className="text-lg font-semibold text-gray-800">연락처가 등록되지 않았습니다</p>
          <p className="text-sm text-gray-500">서명 링크를 복사해 직접 전달해 주세요.</p>
          <div className="rounded-md border bg-white p-2.5 text-xs break-all select-all">{fullSignUrl}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
      <div className="text-center space-y-4 max-w-sm">
        <p className="text-lg font-semibold text-gray-800">문자 앱을 여는 중…</p>
        <p className="text-sm text-gray-500">
          {name} 님({phone})에게 보낼 내용이 채워진 문자 창이 열립니다.
          <br />내용을 확인하고 <b>보내기만 누르면</b> 됩니다.
        </p>
        <a href={smsHref} className="block w-full rounded-lg bg-indigo-600 py-3 text-white font-medium">
          문자 앱이 안 열리면 여기를 누르세요
        </a>
        <p className="text-[11px] text-gray-400">
          PC에서는 문자 앱을 열 수 없습니다 — 아래 서명 링크를 복사해 전달하세요.
        </p>
        <div className="rounded-md border bg-white p-2.5 text-xs break-all select-all">{fullSignUrl}</div>
      </div>
    </div>
  );
}
