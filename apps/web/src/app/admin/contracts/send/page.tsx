"use client";

// 계약서 보내기 — 한 화면 3단계(1 서류 고르기 → 2 내용 입력 → 3 결재자·발송, 2026-10-20 본부 박정인 시안 v2 1번).
// 화면 본체는 「보낸 계약서」와 같은 ContractsScreen 이다 — 2단계 작성 폼·검사·만들기를 그대로 쓴다.
import ContractsScreen from "../ContractsScreen";

export default function ContractSendPage() {
  return <ContractsScreen flow />;
}
