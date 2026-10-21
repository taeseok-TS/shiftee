// 관리자 결재함 › 처리한 요청 탭(2026-10-20 시안 v2 8번) — 화면은 직원 쪽 「내 요청」(/requests)과 같은 것을 관리자 틀 안에서 연다.
// 주소 /admin/requests?who=decided — 결재함 탭이 그대로 보이게. 종전 /requests?who=decided 링크도 그대로 동작한다.
export { default } from "@/app/(dashboard)/requests/page";
