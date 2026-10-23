import { redirect } from "next/navigation";

// 원장 근로시간 리포트 — 뺐다. 근무시간은 본부만 본다(2026-10-23 본부 요청 ■0-11). API 도 원장에게 403.
// 옛 주소 · 알림 · 즐겨찾기로 들어오면 원장 대시보드로 보낸다(본부 리포트는 관리자 모드 「근태 › 근로시간 리포트」)
export default function Page() {
  redirect("/manager/dashboard");
}
