import fs from "fs/promises";
import { prisma } from "@/lib/db";
import { recordContractEvent } from "@/lib/contract-events";
import { maskEmail } from "@/lib/external-verify";

// 외부(미가입) 계약자 완료본 메일(2026-10-16 이예지 QA 7) — 계약이 완료(SIGNED)되고 고정 완료본(PDF)이 만들어진 뒤 부른다.
// 발송 때 받은 이메일(Contract.externalEmail)로 고정 완료본 PDF 를 붙여 보낸다.
//  - **완료본 한 벌(문서번호)마다 한 번** — 교부 기록(DELIVERED)의 meta.docKey 로 판정한다. 결재 회수 뒤 다시 완료되면 새 문서번호라 다시 보낸다(검증 F1)
//  - 고정본이 아직 없으면 보내지 않는다 — 매시 점검(signed-doc-heal)이 고정한 뒤 다시 부른다(검증 F2)
//  - 부르는 곳은 기다리지 않는다(메일 서버가 느려도 서명 응답이 늦지 않게, 검증 F5)
export async function deliverExternalSignedCopy(contractId: string): Promise<void> {
  const c = await prisma.contract.findUnique({
    where: { id: contractId },
    select: { id: true, title: true, status: true, externalName: true, externalEmail: true, signedPdfUrl: true, signedUrl: true, docNo: true },
  });
  if (!c || c.status !== "SIGNED" || !c.externalName || !c.externalEmail) return;
  // 고정본(문서번호 있는 PDF)만 보낸다 — 고정 전 PDF 를 먼저 보내면 고정 뒤 한 번 더 나갔다(재검증 R2)
  const url = c.signedPdfUrl;
  if (!url) return;
  const docKey = c.docNo || url;
  const prev = await prisma.contractEvent.findMany({ where: { contractId, type: "DELIVERED" }, select: { meta: true } });
  if (prev.some((e) => (e.meta as { docKey?: string } | null)?.docKey === docKey)) return;
  const { diskPath } = await import("@/lib/signed-doc");
  const p = diskPath(url);
  try { await fs.access(p); } catch { return; }
  const pdf = { filename: `${c.title.replace(/[\\/:*?"<>|]/g, "_")}${c.docNo ? `_${c.docNo}` : ""}.pdf`, path: p };
  const { sendExternalSignedCopy } = await import("@/lib/email");
  const ok = await sendExternalSignedCopy(c.externalEmail, c.externalName, c.title, pdf);
  if (ok) await recordContractEvent({ contractId, type: "DELIVERED", actorName: "큐브티 봇", meta: { to: maskEmail(c.externalEmail), means: ["메일(완료본 PDF)"], docKey } });
}

/** 기다리지 않고 부른다(오류는 기록만) */
export function deliverExternalSignedCopyLater(contractId: string): void {
  deliverExternalSignedCopy(contractId).catch((e) => console.error("[contract] 외부 완료본 메일 오류:", contractId, e));
}
