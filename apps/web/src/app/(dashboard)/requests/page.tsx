"use client";

// 내 요청(2026-10-07 QA76 #51 #43 #76) — 화면은 components/requests/RequestsView(관리자 결재함 › 처리한 요청과 같이 쓴다)
import { use } from "react";
import RequestsView from "@/components/requests/RequestsView";

export default function RequestsPage({ searchParams }: { searchParams: Promise<{ who?: string }> }) {
  // 본부·원장 메뉴 「처리한 요청」은 ?who=decided 로 들어온다 — 같은 화면에서 주소만 바뀌어도 탭이 따라가게 key 로 다시 그린다
  const initialWho = use(searchParams).who === "decided" ? "decided" : "mine";
  return <RequestsView key={initialWho} initialWho={initialWho} />;
}
