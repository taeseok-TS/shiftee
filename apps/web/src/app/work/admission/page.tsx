import { redirect } from "next/navigation";

// 큐브티워크 「입학정보」 첫 화면 — 지금은 고입 기본계획(2027 서울)로 바로 보낸다(2026-10-14 디렉터 지시)
export default function AdmissionIndexPage() {
  redirect("/work/admission/high-school/seoul");
}
