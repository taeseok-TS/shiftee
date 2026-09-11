import type { PDFDocument, PDFFont } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import fs from "fs/promises";

// 한글 PDF 글꼴 경로. 운영 컨테이너는 FONT_PATH(나눔고딕), 로컬(Windows) 개발은 맑은 고딕.
const KOREAN_FONT_PATH = process.env.FONT_PATH || "C:/Windows/Fonts/malgun.ttf";

/**
 * PDF 에 한글 글꼴을 넣는다 — **통째로**(subset: false). 한글 PDF 는 모두 이 함수로 만든다
 * (연차 대장 · 전자계약 서명 완료 증명 · 묶음 안내 페이지).
 *
 * ⚠ 부분 넣기(subset: true)는 운영 글꼴(나눔고딕)에서 **여러 글자로 된 줄의 글자가 빠진다** — 2026-09-11 연차 대장
 *   PDF 가 "연차 대장 — test5555" 에서 "차"만 남는 식으로 나왔다(MuPDF·PDFium 모두 재현). 로컬 맑은 고딕에서는 멀쩡해서
 *   개발·검증에서 보이지 않았다 — **글꼴 문제는 운영 글꼴로 시험할 것.** 통째로 넣으면 PDF 가 약 2.5MB 커진다.
 */
export async function embedKoreanFont(doc: PDFDocument): Promise<PDFFont> {
  doc.registerFontkit(fontkit);
  return doc.embedFont(await fs.readFile(KOREAN_FONT_PATH), { subset: false });
}
