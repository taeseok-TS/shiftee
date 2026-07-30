import { prisma } from "@/lib/db";
import fs from "fs/promises";
import path from "path";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";

// 계약서 치환 데이터 구성 — 생성(POST /api/contracts)과 수정(PATCH /api/contracts/[id]) 공용

// 금액의 한글 표기 (예: 34000000 → "삼천사백만원") — 근로계약서 金 표기용
export function koreanMoney(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "";
  const digits = ["", "일", "이", "삼", "사", "오", "육", "칠", "팔", "구"];
  const smallUnits = ["", "십", "백", "천"];
  const bigUnits = ["", "만", "억", "조"];
  let result = "";
  let group = 0;
  let v = Math.floor(n);
  while (v > 0) {
    const part = v % 10000;
    if (part) {
      let s = "";
      let p = part, i = 0;
      while (p > 0) {
        const d = p % 10;
        if (d) s = (d === 1 && i > 0 ? "" : digits[d]) + smallUnits[i] + s;
        p = Math.floor(p / 10); i++;
      }
      result = s + bigUnits[group] + result;
    }
    v = Math.floor(v / 10000); group++;
  }
  return result + "원";
}

export const fmtKoreanDate = (d: string | null) => {
  if (!d) return "";
  const date = new Date(d);
  if (isNaN(date.getTime())) return "";
  return `${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일`;
};

// 워드(.docx) 템플릿의 치환 필드({직원명} 등)를 실제 값으로 채워 새 파일 생성
export async function fillDocxTemplate(
  templateFileUrl: string,
  data: Record<string, string>
): Promise<string> {
  const relPath = templateFileUrl.replace(/^\/api\/uploads\//, "");
  const srcPath = path.join(process.cwd(), "uploads", relPath);
  const content = await fs.readFile(srcPath);

  const zip = new PizZip(content);
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    delimiters: { start: "{", end: "}" },
    nullGetter: () => "", // 값이 없는 필드는 빈 문자열
  });
  doc.render(data);

  const buf = doc.getZip().generate({ type: "nodebuffer", compression: "DEFLATE" });
  const filename = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}-contract.docx`;
  const dir = path.join(process.cwd(), "uploads", "contracts");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, filename), buf);
  return `/api/uploads/contracts/${filename}`;
}

export async function buildContractMergeData(
  userId: string,
  opts: {
    title: string;
    startDate: string | null;
    endDate: string | null;
    salary?: string | null;
    extraFields?: Record<string, string> | null;
  }
): Promise<Record<string, string>> {
  const targetUser = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true, email: true, phone: true, branch: true, jobGroup: true, position: true, hireDate: true, birthDate: true, address: true, empNo: true },
  });
  const now = new Date();
  const mergeData: Record<string, string> = {
    직원명: targetUser?.name ?? "",
    이름: targetUser?.name ?? "",
    이메일: targetUser?.email ?? "",
    연락처: targetUser?.phone ?? "",
    지점: targetUser?.branch ?? "",
    직책: targetUser?.jobGroup ?? "",
    직급: targetUser?.position ?? "",
    입사일: targetUser?.hireDate ? fmtKoreanDate(targetUser.hireDate.toISOString()) : "",
    생년월일: targetUser?.birthDate ? fmtKoreanDate(targetUser.birthDate.toISOString()) : "",
    주소: targetUser?.address ?? "", // 프로필 자동 채움 — 서명 시 비어 있으면 직원이 입력
    사원번호: targetUser?.empNo != null ? String(targetUser.empNo).padStart(5, "0") : "",
    제목: opts.title,
    계약시작일: fmtKoreanDate(opts.startDate),
    계약종료일: fmtKoreanDate(opts.endDate),
    연봉: opts.salary ? `${Number(opts.salary).toLocaleString()}원` : "",
    작성일: fmtKoreanDate(now.toISOString()),
    // 연봉에서 자동 산출되는 제8조 금액들 (식대 200,000원 고정 기준)
    ...(opts.salary && Number(opts.salary) > 0
      ? (() => {
          const sal = Math.floor(Number(opts.salary));
          const monthly = Math.floor(sal / 12); // 월 급여합계 (기본급 + 식대)
          return {
            연봉한글: koreanMoney(sal),
            연봉총액: `${sal.toLocaleString()}원`,
            월급여합계: `${monthly.toLocaleString()}원`,
            기본급: `${(monthly - 200000).toLocaleString()}원`,
          };
        })()
      : {}),
    // 서명 자리 마커 — 서명 완료본 생성 시 이 자리에 서명 이미지가 들어간다
    근로자서명: "《근로자서명》",
    대표서명: "《대표서명》",
  };
  // 계약 구분 — 템플릿의 {#신규입사}/{#재계약} 조건 구간 제어 (빈 문자열=구간 제거)
  const isRenewal = opts.extraFields?.["계약구분"] === "재계약";
  mergeData["신규입사"] = isRenewal ? "" : "1";
  mergeData["재계약"] = isRenewal ? "1" : "";

  // 개인정보동의서 선택 항목(고유식별정보·채용정보 수신) — 기본 동의, 미동의로 변경 가능
  mergeData["동의고유식별"] = consentBox(opts.extraFields?.["동의고유식별"]);
  mergeData["동의채용정보"] = consentBox(opts.extraFields?.["동의채용정보"]);

  // 템플릿별 추가 입력 필드 — 자동 필드는 덮어쓰지 않음, 날짜는 한국식 표기로 변환
  if (opts.extraFields) {
    for (const [k, v] of Object.entries(opts.extraFields)) {
      if (k in mergeData || typeof v !== "string") continue; // 자동/동의 필드는 위에서 처리
      mergeData[k] = /^\d{4}-\d{2}-\d{2}$/.test(v) ? fmtKoreanDate(v) : v;
    }
  }
  return mergeData;
}

// 템플릿(.docx)이 참조하는 직원 프로필 필드 목록 반환 — 서명 시 비어 있으면 입력 유도
// 현재 대상: 주소(User.address), 생년월일(User.birthDate)
export async function scanTemplateProfileFields(templateFileUrl: string): Promise<string[]> {
  if (!templateFileUrl.toLowerCase().endsWith(".docx")) return [];
  try {
    const rel = templateFileUrl.replace(/^\/api\/uploads\//, "");
    const buf = await fs.readFile(path.join(process.cwd(), "uploads", rel));
    const xml = new PizZip(buf).file("word/document.xml")?.asText() || "";
    const text = (xml.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) || []).map((t) => t.replace(/<[^>]+>/g, "")).join("");
    const found: string[] = [];
    for (const f of ["주소", "생년월일"]) if (text.includes(`{${f}}`)) found.push(f);
    return found;
  } catch {
    return [];
  }
}

// 시스템이 자동으로 채우거나 별도 처리하는 필드(직원 입력 대상이 아님)
const SYSTEM_FIELDS = new Set([
  "직원명", "이름", "이메일", "연락처", "지점", "직책", "직급", "입사일", "생년월일", "주소",
  "사원번호", "제목", "계약시작일", "계약종료일", "연봉", "작성일",
  "연봉한글", "연봉총액", "월급여합계", "기본급", "신규입사", "재계약",
  "동의고유식별", "동의채용정보", "근로자서명", "대표서명", "원장서명", "본부서명",
]);

// 날짜·금액·체크박스류 필드는 관리자가 작성 시 지정(퇴사일자·지급희망일·지급금품 체크·수령방법 등),
// 자유서술만 직원이 서명 시 입력(퇴사사유 등)
const ADMIN_INPUT_PATTERN = /일자|날짜|기간|일$|연봉|금액|급여|수당|시각|시간|^체크_|기타내용|방법/;

// 템플릿(.docx)에서 "직원이 서명 시 직접 입력하는" 문서 전용 필드 목록 반환.
// 시스템 자동/프로필/동의/서명 필드가 아니고, 날짜·금액류(관리자 입력)도 아닌 자유서술 필드(예: 퇴사사유).
// 프로필 필드(주소/생년월일)와 달리 프로필에 저장하지 않고 해당 문서에만 반영한다.
export async function scanEmployeeFillFields(templateFileUrl: string): Promise<string[]> {
  if (!templateFileUrl.toLowerCase().endsWith(".docx")) return [];
  try {
    const rel = templateFileUrl.replace(/^\/api\/uploads\//, "");
    const buf = await fs.readFile(path.join(process.cwd(), "uploads", rel));
    const xml = new PizZip(buf).file("word/document.xml")?.asText() || "";
    const found: string[] = [];
    // 워드가 run을 쪼개도 인식되도록 문단 단위로 텍스트를 이어붙여 스캔
    for (const p of xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) || []) {
      const text = (p.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) || []).map((t) => t.replace(/<[^>]+>/g, "")).join("");
      for (const m of text.matchAll(/\{([^{}\n]{1,30})\}/g)) {
        const name = m[1].trim();
        if (name.startsWith("#") || name.startsWith("/")) continue; // 조건 구간 제외
        if (SYSTEM_FIELDS.has(name)) continue;
        if (ADMIN_INPUT_PATTERN.test(name)) continue; // 날짜·금액류는 관리자 입력
        if (!found.includes(name)) found.push(name);
      }
    }
    return found;
  } catch {
    return [];
  }
}

// 동의 체크박스 문자열 — "미동의"면 동의하지 않음에 체크, 그 외(기본)는 동의함에 체크
export function consentBox(choice?: string): string {
  return choice === "미동의"
    ? "(□ 동의함    ☒ 동의하지 않음)"
    : "(☒ 동의함    □ 동의하지 않음)";
}

// 결재 승인 창 표시용 입력값 요약 (연봉 + 템플릿 동적 필드, 표시용 포맷)
export function buildFieldSummary(
  salary?: string | null,
  extraFields?: Record<string, string> | null
): Record<string, string> {
  const summary: Record<string, string> = {};
  if (salary) summary["연봉"] = `${Number(salary).toLocaleString()}원`;
  if (extraFields) {
    for (const [k, v] of Object.entries(extraFields)) {
      if (typeof v !== "string" || !v) continue;
      summary[k] = /^\d{4}-\d{2}-\d{2}$/.test(v) ? fmtKoreanDate(v) : v;
    }
  }
  return summary;
}
