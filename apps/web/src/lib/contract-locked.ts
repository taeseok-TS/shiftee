import { prisma } from "@/lib/db";

// 비밀번호가 걸린 모두싸인 체결본(2026-11-04 이예지 「잠긴 채로 보관」) — 10/26 이관분 118건. 문서마다 비밀번호가 달라 풀지 않고 그대로 둔다.
//  · 목록에 「🔒 비밀번호 필요」 표시(pdfLocked) — 눌러도 반응이 없어 고장처럼 보였다.
//  · 본부(ADMIN)만 연다: 브라우저 PDF 화면이 비밀번호 칸을 띄우고, 비밀번호는 브라우저 안에서만 쓰인다(서버로 오지 않고 저장도 안 함).
//    열 때 화면이 POST 로 「잠긴 문서 열람」(LOCKED_OPENED)을 남긴다(누가·언제).
//  · 원장·직원·재무 열람 계정에는 파일을 주지 않고 「본부에 요청해 주세요」.
//  · 본부가 풀린 사본을 다시 받으면 같은 문서 ID 로 바꿔 넣고 이 목록에서 뺀다.
// 목록은 AppSetting `contracts.lockedPdf` (계약 id JSON 배열).
export const LOCKED_PDF_KEY = "contracts.lockedPdf";
export const LOCKED_PDF_MESSAGE = "비밀번호가 걸린 문서입니다. 열람이 필요하면 본부에 요청해 주세요.";

export async function lockedPdfIds(): Promise<Set<string>> {
  const row = await prisma.appSetting.findUnique({ where: { key: LOCKED_PDF_KEY } });
  if (!row) return new Set();
  try {
    const v = JSON.parse(row.value);
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  } catch (e) {
    console.error("[contract-locked] 잠금 목록 값이 깨졌습니다(빈 목록으로 봄):", e);
    return new Set();
  }
}

export async function isLockedPdf(contractId: string): Promise<boolean> {
  return (await lockedPdfIds()).has(contractId);
}
