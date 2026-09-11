"use client";

// 계약 감사 기록(#205-4) — 결재 히스토리 창 아래. 발송·열람·본인 확인·동의·서명·반려·회수·수정을 시각·IP·기기와 함께.
import { useEffect, useState } from "react";

type Ev = {
  id: string; type: string; actorName: string | null; stepOrder: number | null;
  ip: string | null; userAgent: string | null; deviceId: string | null;
  meta: Record<string, unknown> | null; createdAt: string;
};

const LABEL: Record<string, string> = {
  SENT: "발송", RESEND: "재발송", EDITED: "내용 수정", RESET: "결재 초기화", VIEWED: "문서 열람",
  VERIFY_OK: "본인 확인 통과", VERIFY_FAIL: "본인 확인 실패", CONSENT: "전자서명 동의", SIGNED: "서명",
  COMPLETED: "계약 완료", REJECTED: "반려", REVOKED: "회수",
};

// 사람이 읽을 수 있는 접속 기기 — 앱은 기기 번호를 싣는다
function device(e: Ev): string {
  const ua = e.userAgent || "";
  const app = e.deviceId ? "앱" : /okhttp|Expo|CFNetwork|Dalvik/i.test(ua) ? "앱" : "웹";
  const os = /iPhone|iPad|iOS|CFNetwork|Darwin/i.test(ua) ? "iOS" : /Android|okhttp|Dalvik/i.test(ua) ? "Android"
    : /Windows/i.test(ua) ? "Windows" : /Mac OS/i.test(ua) ? "Mac" : "";
  return [app, os].filter(Boolean).join(" · ") + (e.deviceId ? ` (${e.deviceId.slice(0, 8)}…)` : "");
}

function detail(e: Ev): string {
  const m = e.meta || {};
  if (e.type === "CONSENT") return m.readToEnd === true ? "문서를 끝까지 열람함" : m.readToEnd === false ? "끝까지 열람하지 않음" : "";
  if (e.type === "EDITED" && Array.isArray(m.fields)) return `바뀐 항목: ${(m.fields as string[]).join(", ")}`;
  if ((e.type === "REJECTED" || e.type === "REVOKED") && typeof m.reason === "string") return `사유: ${m.reason}`;
  if (e.type === "SIGNED" && typeof m.role === "string") return `${m.role}${m.savedSignature ? " · 저장 서명" : ""}`;
  if (e.type === "RESET" && Array.isArray(m.signers)) return `초기화된 서명: ${(m.signers as string[]).join(", ") || "없음"}`;
  return "";
}

const kst = (s: string) => new Date(new Date(s).getTime() + 9 * 3600 * 1000).toISOString().slice(0, 19).replace("T", " ");

export default function ContractEventsList({ contractId }: { contractId: string }) {
  const [events, setEvents] = useState<Ev[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    fetch(`/api/contracts/${contractId}/events`)
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!alive) return;
        if (!r.ok) { setError(d.error || "감사 기록을 불러오지 못했습니다."); return; }
        setEvents(d.events || []);
      })
      .catch(() => { if (alive) setError("감사 기록을 불러오지 못했습니다."); });
    return () => { alive = false; };
  }, [contractId]);

  return (
    <div className="space-y-2 pt-2 border-t">
      <p className="text-sm font-medium text-gray-700">감사 기록</p>
      {error && <p className="text-xs text-red-500">{error}</p>}
      {!error && events === null && <p className="text-xs text-gray-400">불러오는 중…</p>}
      {events && events.length === 0 && (
        <p className="text-xs text-gray-400">기록이 없습니다(2026-09-11 이후 진행분부터 남습니다).</p>
      )}
      {events && events.length > 0 && (
        <ul className="space-y-1.5">
          {events.map((e) => (
            <li key={e.id} className="text-xs rounded border bg-gray-50 px-2 py-1.5">
              <div className="flex justify-between gap-2">
                <span className="font-medium text-gray-800">
                  {LABEL[e.type] || e.type}{e.stepOrder ? ` · ${e.stepOrder}단계` : ""}{e.actorName ? ` · ${e.actorName}` : ""}
                </span>
                <span className="text-gray-500 shrink-0">{kst(e.createdAt)}</span>
              </div>
              <div className="text-gray-500 break-all">
                {[e.ip ? `IP ${e.ip}` : "", device(e), detail(e)].filter(Boolean).join(" · ")}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
