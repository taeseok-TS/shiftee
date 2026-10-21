import PizZip from "pizzip";
import { generateDeterministic } from "@/lib/docx-zip";

// 서명 자리 표시(《근로자서명》《대표서명》《원장서명》《본부서명》)를 **보기용 PDF** 에서 지운다(2026-10-21 디렉터 「고쳐」).
// 이 표시는 서명이 들어갈 자리를 찾는 내부 표식이라(lib/signed-doc 이 서명할 때 그림으로 바꾼다) 서명 전 원본을 그대로 변환하면
// 승인·서명 화면에 글자 그대로 보였다. 저장된 계약 파일은 그대로 두고 변환하기 직전의 사본에서만 지운다 — 서명 처리는 원본 파일의 표시를 쓴다.
// 「(인)」 같은 양식 글자는 남긴다(서명 반영본에서 서명 안 된 자리와 같은 모양).
const MARK = /《(?:근로자|대표|원장|본부)서명》/g;
const PART = /^word\/(?:document|header\d*|footer\d*)\.xml$/;

/** 보기용 캐시 구분값 — 표시를 지운 변환본이 예전(표시가 보이던) 캐시와 섞이지 않게 키에 붙인다 */
export const MARKER_STRIP_TAG = "nomark1";

export function stripSignMarkers(docx: Buffer): Buffer {
  try {
    const zip = new PizZip(docx);
    let changed = false;
    for (const name of Object.keys(zip.files)) {
      if (!PART.test(name)) continue;
      const xml = zip.file(name)?.asText();
      if (!xml || !xml.includes("서명》")) continue;
      const next = xml.replace(MARK, "");
      if (next !== xml) { zip.file(name, next); changed = true; }
    }
    // 묶을 때 현재 시각이 박히지 않게(같은 입력 → 같은 바이트, 바이트 기준 캐시가 맞도록 — docx 바이트 떠돌이 함정)
    return changed ? generateDeterministic(zip) : docx;
  } catch {
    return docx;   // 워드가 아니거나 깨졌으면 그대로 변환(종전과 같음)
  }
}
