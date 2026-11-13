// 큐브티워크 「합격 · 성적 사례」 — 공통 상수 · 입력 검사 (2026-11-13 디렉터 결정)
//
// 서버 · 클라이언트가 함께 쓰는 순수 모듈. Prisma · fs 를 여기서 import 하지 않는다.
// 결정: ① 새 게시판 + 「마케팅 자료로도 보내기」 연결 ② 열람 = 튜터 빼고 전 직원(본부 포함) ③ 축하 · 댓글 넣음.
// 내부 학습용이라도 학생 실명은 받지 않는다 — 학년 + 성(1~2자)만 저장하고 「김○○」로 보인다.
import { ALLOWED_EXT, HEIC_EXT, extOf, type SubmissionFile } from "@/lib/submissions";

export const CASE_KINDS = ["UNIV", "HS", "GRADE"] as const;
export type CaseKind = (typeof CASE_KINDS)[number];
export const CASE_KIND_LABEL: Record<CaseKind, string> = { UNIV: "대입 합격", HS: "고입 합격", GRADE: "성적 상승" };

export const STUDENT_GRADES = ["중1", "중2", "중3", "고1", "고2", "고3", "N수"] as const;
export const GENDERS = ["남", "여"] as const;
export const SCHOOL_TYPES = ["일반고", "자사고", "특목고(외고·국제고)", "과학고·영재고", "중학교", "기타"] as const;
export const GRADE_BASES = ["내신", "모의고사", "수능", "기타"] as const;
export const OUTCOMES = ["합격", "추가합격", "예비", "불합격"] as const;

/** 볼 수 없는 직군 — 디렉터 결정 ②(튜터 빼고 전 직원) */
export const CASE_BLOCKED_JOB_GROUP = "튜터";
/** 직군이 비어 있어도 직책이 튜터면 막는다(검증관 P1 — 인사명부 연동이 애매한 직무를 직군 없이 넣는 경우) */
export function canViewCasesBy(role: string | null | undefined, jobGroup: string | null | undefined, position?: string | null): boolean {
  if (role === "ADMIN") return true;
  if ((jobGroup || "").trim() === CASE_BLOCKED_JOB_GROUP) return false;
  return !(position || "").includes(CASE_BLOCKED_JOB_GROUP);
}

/** 두 글자 성(복성) — 이 밖의 두 글자는 이름으로 보고 막는다(검증관 P2 — 「이준」 같은 두 글자 이름이 성 칸을 통과했다) */
export const COMPOUND_SURNAMES = ["남궁", "제갈", "선우", "황보", "독고", "사공", "서문", "동방", "어금", "망절", "소봉", "장곡"] as const;

export const CASE_MAX_FILES = 5;
export const STRATEGY_MIN = 30;
export const STRATEGY_MAX = 4000;
export const COMMENT_MAX = 1000;
export const RESULTS_MAX = 12;

/** 사례 첨부로 받는 확장자 — 자료제출 허용 목록에서 HEIC(브라우저가 못 그림) · ZIP(안을 못 봄)을 뺀 것 */
export function caseFileAllowed(name: string): boolean {
  const ext = extOf(name);
  return ALLOWED_EXT.has(ext) && !HEIC_EXT.has(ext) && ext !== ".zip";
}

/** 「고3 김○○ (여)」 */
export function studentLabel(c: { studentGrade: string; studentSurname: string; studentGender?: string | null }): string {
  return `${c.studentGrade} ${c.studentSurname}○○${c.studentGender ? ` (${c.studentGender})` : ""}`;
}

/** 등급 숫자 → 등급대(1~9). 없으면 null */
export function gradeBandOf(g: number | null | undefined): number | null {
  if (g === null || g === undefined || !Number.isFinite(g)) return null;
  return Math.min(9, Math.max(1, Math.floor(g)));
}

export type CaseResult = { school: string; track: string; major: string; outcome: string };

export type CaseInput = {
  kind: CaseKind; title: string;
  studentGrade: string; studentSurname: string; studentGender: string | null;
  region: string | null; schoolType: string | null; periodMonths: number | null;
  gradeBasis: string | null; gradeFrom: number | null; gradeTo: number | null;
  beforeText: string | null; afterText: string | null;
  results: CaseResult[]; strategy: string;
};

const str = (v: unknown, max: number): string => (typeof v === "string" ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim().slice(0, max) : "");
const opt = (v: unknown, max: number): string | null => str(v, max) || null;
const oneOf = <T extends readonly string[]>(v: unknown, list: T): T[number] | null => (typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T[number]) : null);
function grade(v: unknown): number | null | "bad" {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.trim()) : NaN;
  if (!Number.isFinite(n) || n < 1 || n > 9) return "bad";
  return Math.round(n * 100) / 100;
}

/** 작성 · 수정 본문 검사 — 서버가 부른다(화면도 같은 규칙으로 미리 막는다). 실패하면 사람이 읽는 오류 문장 */
export function parseCaseInput(body: Record<string, unknown>): { ok: true; value: CaseInput } | { ok: false; error: string } {
  const kind = oneOf(body.kind, CASE_KINDS);
  if (!kind) return { ok: false, error: "사례 종류(대입 합격 · 고입 합격 · 성적 상승)를 골라주세요." };
  const title = str(body.title, 100);
  if (!title) return { ok: false, error: "한 줄 제목을 적어주세요. 예: 내신 4.1 → 2.3, 학종으로 ○○대 합격" };
  const studentGrade = oneOf(body.studentGrade, STUDENT_GRADES);
  if (!studentGrade) return { ok: false, error: "학생 학년을 골라주세요." };
  const studentSurname = str(body.studentSurname, 4);
  // 성만 받는다 — 한글 1~2자(남궁 · 제갈 등). 이름 전체를 적으면 막는다
  if (!/^[가-힣]{1,2}$/.test(studentSurname) || (studentSurname.length === 2 && !(COMPOUND_SURNAMES as readonly string[]).includes(studentSurname)))
    return { ok: false, error: "학생은 성만 적어주세요(한 글자, 남궁 · 제갈 같은 두 글자 성 포함). 이름은 저장하지 않습니다." };
  const studentGender = oneOf(body.studentGender, GENDERS);
  const schoolType = oneOf(body.schoolType, SCHOOL_TYPES);
  const gradeBasis = oneOf(body.gradeBasis, GRADE_BASES);
  let periodMonths: number | null = null;
  if (body.periodMonths !== null && body.periodMonths !== undefined && body.periodMonths !== "") {
    const n = Number(body.periodMonths);
    if (!Number.isInteger(n) || n < 1 || n > 120) return { ok: false, error: "관리 기간은 1~120개월 사이 숫자로 적어주세요." };
    periodMonths = n;
  }
  const gf = grade(body.gradeFrom), gt = grade(body.gradeTo);
  if (gf === "bad" || gt === "bad") return { ok: false, error: "등급은 1.0~9.0 사이 숫자로 적어주세요." };
  const beforeText = opt(body.beforeText, 500), afterText = opt(body.afterText, 500);

  const results: CaseResult[] = [];
  if (Array.isArray(body.results)) {
    for (const r of body.results.slice(0, RESULTS_MAX)) {
      if (!r || typeof r !== "object") continue;
      const o = r as Record<string, unknown>;
      const school = str(o.school, 60), track = str(o.track, 60), major = str(o.major, 60);
      const outcome = oneOf(o.outcome, OUTCOMES) ?? "합격";
      if (school) results.push({ school, track, major, outcome });
    }
  }
  if (kind !== "GRADE" && results.length === 0) return { ok: false, error: "지원 · 합격 결과를 한 줄 이상 적어주세요(학교 이름)." };
  if (kind === "GRADE" && gf === null && gt === null && !beforeText && !afterText)
    return { ok: false, error: "시작 성적과 결과 성적을 적어주세요(평균 등급 또는 과목별)." };

  const strategy = str(body.strategy, STRATEGY_MAX);
  if (strategy.length < STRATEGY_MIN) return { ok: false, error: `전략 · 노하우를 ${STRATEGY_MIN}자 이상 적어주세요. 다른 지점 매니저가 따라 할 수 있게요.` };

  return {
    ok: true,
    value: {
      kind, title, studentGrade, studentSurname, studentGender,
      region: opt(body.region, 30), schoolType, periodMonths,
      gradeBasis, gradeFrom: gf, gradeTo: gt, beforeText, afterText, results, strategy,
    },
  };
}

export function schoolsTextOf(results: CaseResult[]): string {
  return results.map((r) => [r.school, r.track, r.major].filter(Boolean).join(" ")).join(" / ").slice(0, 1000);
}

/** 화면 · 응답에 쓰는 첨부 목록 정리(옛 값 · 잘못된 값 방어) */
export function caseFilesOf(v: unknown): SubmissionFile[] {
  return Array.isArray(v) ? (v.filter((f) => f && typeof f === "object" && typeof (f as SubmissionFile).url === "string") as SubmissionFile[]) : [];
}
