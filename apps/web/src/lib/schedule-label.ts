// 근무 시간 종류(근무일정 신청의 templateName) 화면 표기 — 순수 함수(서버 · 화면 공용, 2026-10-23 오픈 전 요청 ■0-4 · ■3 대시보드)
//
// 신청 화면(웹 (dashboard)/schedule/request · 앱 ScheduleScreen)이 종류 이름 뒤에 「(시작~끝)」을 붙여 보낸다.
// 그런데 본부가 만든 종류 이름에 이미 시간이 들어 있으면(「학기중(13:00~22:00)」) 「학기중(13:00~22:00) (13:00~22:00)」처럼 두 번 나왔다.
//  · 이름 안에 같은 시간이 이미 있으면 끝에 붙은 「(시간)」을 뺀다
//  · 「직접설정」 → 「직접 입력」(화면 말 규칙)
//  · 시간 사이 「~」 「-」 → 「–」(13:00–22:00)
// 저장(api/schedule-requests POST)과 화면(결재함 · 대시보드 · 내 요청)이 이 함수 하나를 쓴다. 이미 저장된 옛 이름도 화면에서 고쳐 보인다.

const TIME_RE = /(\d{1,2}):(\d{2})\s*[~\-–—]\s*(\d{1,2}):(\d{2})/g;
const norm = (h: string, m: string, h2: string, m2: string) => `${h.padStart(2, "0")}:${m}–${h2.padStart(2, "0")}:${m2}`;

export function templateLabel(name: string | null | undefined): string {
  let s = (name ?? "").trim();
  if (!s) return "";
  s = s.replace(/직접\s*설정/g, "직접 입력");
  // 끝에 붙은 「(시간)」이 앞쪽에도 있으면 뺀다 — 여러 번 겹쳐 있어도 하나만 남을 때까지
  for (let i = 0; i < 3; i++) {
    const m = /\s*\(\s*(\d{1,2}):(\d{2})\s*[~\-–—]\s*(\d{1,2}):(\d{2})\s*\)\s*$/.exec(s);
    if (!m) break;
    const tail = norm(m[1], m[2], m[3], m[4]);
    const head = s.slice(0, m.index);
    const inHead = [...head.matchAll(TIME_RE)].some((x) => norm(x[1], x[2], x[3], x[4]) === tail);
    if (!inHead) break;
    s = head.trim();
  }
  return s.replace(TIME_RE, (_all, a: string, b: string, c: string, d: string) => norm(a, b, c, d));
}
