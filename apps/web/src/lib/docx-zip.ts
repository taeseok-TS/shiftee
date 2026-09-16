// 워드(docx) 파일을 **결정적으로** 만들어 주는 한 곳.
//
// PizZip 은 `zip.file(이름, 내용)` 으로 새로 쓴 항목에 **그때의 현재 시각**을 박는다
// (object.js: `o.date = o.date || new Date()`). 그래서 내용이 완전히 같아도 1초 뒤에 만들면
// 바이트가 달라진다. 이것 때문에 2026-09-16 에 넣은 "변환 직전 바이트를 키로 쓰는 PDF 캐시"가
// 서명 창.발송 전 확인(템플릿 재렌더.서명 합성 경로)에서 **한 번도 맞지 않고 쓰기만 쌓였다**
// (검증관 실측). 항목 시각을 고정하면 같은 입력 → 같은 바이트가 되어 캐시가 제대로 맞는다.
//
// 부수 효과로 "같은 계약을 두 번 만들면 파일이 동일한가"를 말할 수 있게 된다 — 진본성 논쟁에 쓸모가 있다.
// 고정 시각은 zip(DOS) 이 표현할 수 있는 1980년 이후여야 한다.
const FIXED_ENTRY_DATE = new Date(Date.UTC(2020, 0, 1, 0, 0, 0));

type ZipLike = {
  files: Record<string, { date?: Date; options?: { date?: Date } }>;
  generate: (opts: { type: "nodebuffer"; compression: "DEFLATE" }) => Buffer;
};

/** 모든 항목의 시각을 고정한 뒤 생성한다 — 같은 내용이면 항상 같은 바이트가 나온다. */
export function generateDeterministic(zip: ZipLike): Buffer {
  for (const name of Object.keys(zip.files)) {
    const f = zip.files[name];
    if (!f) continue;
    // generate 는 `_initialMetadata.date !== file.date` 일 때 file.date 를, 아니면 options.date 를 쓴다.
    // 두 자리를 함께 맞춰 어느 쪽을 보든 같은 값이 되게 한다.
    f.date = FIXED_ENTRY_DATE;
    if (f.options) f.options.date = FIXED_ENTRY_DATE;
  }
  return zip.generate({ type: "nodebuffer", compression: "DEFLATE" });
}
