import { PDFDocument, rgb, degrees } from "pdf-lib";
import { embedKoreanFont } from "@/lib/pdf-korean-font";

// 시험 문서(나에게 테스트 발송 #67) PDF 에 「테스트」 표시(2026-10-08, 본부 답변) — 모든 쪽 가운데 대각선 워터마크 + 우상단 표식.
// 실제 계약과 섞이지 않게 눈에 띄는 색으로. 글꼴은 운영 한글 글꼴을 통째로 넣는다(부분 넣기는 글자가 빠진다 — lib/pdf-korean-font.ts)
export async function stampTestPdf(buf: Buffer): Promise<Buffer> {
  const doc = await PDFDocument.load(buf, { ignoreEncryption: true });
  const font = await embedKoreanFont(doc);
  const red = rgb(0.85, 0.2, 0.2);
  for (const page of doc.getPages()) {
    const { width, height } = page.getSize();
    const big = "테스트 문서 — 효력 없음";
    const size = Math.min(40, width / 14);
    const tw = font.widthOfTextAtSize(big, size);
    // 30° 기울여 가운데 — 회전은 글자 시작점 기준이라 시작점을 왼쪽 아래로 잡는다
    page.drawText(big, { x: width / 2 - (tw / 2) * Math.cos(Math.PI / 6), y: height / 2 - (tw / 2) * Math.sin(Math.PI / 6), size, font, color: red, opacity: 0.22, rotate: degrees(30) });
    const small = "테스트";
    const sw = font.widthOfTextAtSize(small, 12);
    page.drawRectangle({ x: width - sw - 36, y: height - 34, width: sw + 16, height: 20, color: red, opacity: 0.9 });
    page.drawText(small, { x: width - sw - 28, y: height - 29, size: 12, font, color: rgb(1, 1, 1) });
  }
  return Buffer.from(await doc.save());
}
