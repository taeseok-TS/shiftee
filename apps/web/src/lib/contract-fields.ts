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
// opts.highlight (#100, 2026-08-27): 미리보기 전용 — 치환된 값을 노란 하이라이트로,
// 값이 비어 있는 필드는 붉은 〔미입력〕 표시로 렌더해 확인 포인트가 한눈에 보이게 한다.
// 방식: 값을 사설영역 센티널(~)로 감싸 렌더한 뒤 XML 후처리로 하이라이트 run 분리.
export async function fillDocxTemplate(
  templateFileUrl: string,
  data: Record<string, string>,
  opts?: { highlight?: boolean }
): Promise<string> {
  const relPath = templateFileUrl.replace(/^\/api\/uploads\//, "");
  const srcPath = path.join(process.cwd(), "uploads", relPath);
  const content = await fs.readFile(srcPath);

  const hl = !!opts?.highlight;
  const HS = "", HE = "", MS = "", ME = ""; // 하이라이트 센티널 (사설영역)
  const renderData: Record<string, string> = hl
    ? Object.fromEntries(Object.entries(data).map(([k, v]) => {
        // 조건 플래그·서명 마커·빈 값은 감싸지 않는다
        if (k === "신규입사" || k === "재계약" || !v || /^《.*》$/.test(v)) return [k, v];
        return [k, HS + v + HE];
      }))
    : data;

  const zip = new PizZip(content);
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    delimiters: { start: "{", end: "}" },
    // 값이 없는 필드는 빈 문자열. 단 체크박스류(체크_/선택_)는 빈칸이 아니라
    // 미선택(□)으로 보여야 한다 — 값 누락 시 항목 글자만 남고 네모가 사라지는 것 방지
    nullGetter: (part: { value?: string }) => {
      const tag = part?.value || "";
      if (tag.startsWith("체크_") || tag.startsWith("선택_") || tag.startsWith("확인_")) return "□";
      return hl ? MS + "〔미입력〕" + ME : "";
    },
  });
  doc.render(renderData);

  if (hl) {
    // 센티널 → 하이라이트 run 분리 (센티널은 항상 w:t 안에 있다)
    let xml = doc.getZip().file("word/document.xml")!.asText();
    xml = xml
      .replace(//g, '</w:t></w:r><w:r><w:rPr><w:highlight w:val="yellow"/></w:rPr><w:t xml:space="preserve">')
      .replace(//g, '</w:t></w:r><w:r><w:t xml:space="preserve">')
      .replace(//g, '</w:t></w:r><w:r><w:rPr><w:b/><w:color w:val="CC0000"/></w:rPr><w:t xml:space="preserve">')
      .replace(//g, '</w:t></w:r><w:r><w:t xml:space="preserve">');
    doc.getZip().file("word/document.xml", xml);
  }

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
    // 외부(미가입) 계약자 — 직원 정보 대신 관리자가 입력한 이름·연락처 사용,
    // 나머지 개인정보(생년월일·주소·지점 등)는 extraFields로 자동 필드까지 덮어쓸 수 있음
    external?: { name: string; phone?: string | null } | null;
  }
): Promise<Record<string, string>> {
  const targetUser = opts.external ? null : await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true, email: true, phone: true, branch: true, jobGroup: true, position: true, hireDate: true, birthDate: true, address: true, empNo: true },
  });
  const now = new Date();
  const mergeData: Record<string, string> = {
    직원명: opts.external?.name ?? targetUser?.name ?? "",
    이름: opts.external?.name ?? targetUser?.name ?? "",
    이메일: targetUser?.email ?? "",
    연락처: opts.external?.phone ?? targetUser?.phone ?? "",
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
            식대: "200,000원", // 코디 계약서 급여표 — 기본급 계산과 동일한 식대 고정값
            연봉숫자: sal.toLocaleString(), // "₩ {연봉숫자} 원" 표기용(원 미포함)
          };
        })()
      : {}),
    // 서명 자리 마커 — 서명 완료본 생성 시 이 자리에 서명 이미지가 들어간다
    근로자서명: "《근로자서명》",
    대표서명: "《대표서명》",
    // 지점명 — "…{지점명} 지점" 조합용. 지점 이름에 이미 "지점"이 붙어 있으면(테스트지점 등)
    // "테스트지점 지점"처럼 중복되던 문제 해결 (#96·#116·#120, 2026-08-27)
    지점명: (targetUser?.branch ?? "").replace(/\s*지점$/, ""),
  };
  // 계약 구분 — 템플릿의 {#신규입사}/{#재계약} 조건 구간 제어 (빈 문자열=구간 제거)
  const isRenewal = opts.extraFields?.["계약구분"] === "재계약";
  mergeData["신규입사"] = isRenewal ? "" : "1";
  mergeData["재계약"] = isRenewal ? "1" : "";

  // 개인정보동의서 선택 항목(고유식별정보·채용정보 수신) — 기본 동의, 미동의로 변경 가능
  mergeData["동의고유식별"] = consentBox(opts.extraFields?.["동의고유식별"]);
  mergeData["동의채용정보"] = consentBox(opts.extraFields?.["동의채용정보"]);

  // 템플릿별 추가 입력 필드 — 자동 필드는 덮어쓰지 않음(외부 계약은 직원 정보가 없어 덮어쓰기 허용),
  // 날짜는 한국식 표기로 변환
  if (opts.extraFields) {
    for (const [k, v] of Object.entries(opts.extraFields)) {
      if (typeof v !== "string") continue;
      // 동의 필드는 consentBox 변환값("☒ 동의함…")을 유지 — 외부 계약에서도 원시값("미동의")으로 덮지 않음
      if (k in mergeData && !(opts.external && v.trim() !== "" && !["직원명", "이름", "제목", "작성일", "근로자서명", "대표서명", "원장서명", "본부서명", "동의고유식별", "동의채용정보"].includes(k))) continue;
      if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
        mergeData[k] = fmtKoreanDate(v);
      } else if (/금액|급여액|월급|수당액|비용/.test(k) && /^[\d,]+$/.test(v.trim()) && v.trim() !== "") {
        // 금액 필드에 숫자만 입력된 경우 → 천 단위 쉼표 + "원" 표기 (예: 1210000 → 1,210,000원)
        mergeData[k] = `${Number(v.replace(/,/g, "")).toLocaleString()}원`;
      } else {
        mergeData[k] = v;
      }
    }
  }
  // 실무평가 단계 급여 지급률 — 기본 85, 관리자가 100 선택 시 반영 (#92).
  // ⚠️ extraFields 루프 "이후"에 기본값을 채워야 한다 — 미리 시딩하면 위 가드(k in mergeData)가
  //    내부 계약에서 관리자 선택값을 건너뛰어 항상 85로 찍힌다 (검증관 2026-08-27 CONFIRMED)
  if (!mergeData["실무지급률"]) mergeData["실무지급률"] = "85";
  // 파생 표기 필드 — extraFields 반영 이후에 계산 (2026-08-27)
  // 금품청산 "기타" — 체크했고 내용이 있을 때만 괄호로 표기, 아니면 빈칸 (#120)
  const gitaOn = (opts.extraFields?.["체크_기타"] || "") === "☑";
  const gitaTxt = (opts.extraFields?.["지급기타내용"] || "").trim();
  mergeData["지급기타표기"] = gitaOn && gitaTxt ? `( ${gitaTxt} )` : "";
  // 개인정보동의서 필수 항목 — 서명 시 명시 동의(동의필수="동의")해야 ☒, 그 전엔 빈 체크 (#104)
  mergeData["동의필수표기"] = consentBox(opts.extraFields?.["동의필수"]);
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
  "연봉한글", "연봉총액", "월급여합계", "기본급", "식대", "연봉숫자", "신규입사", "재계약",
  "동의고유식별", "동의채용정보", "근로자서명", "대표서명", "원장서명", "본부서명",
  "지점명", "지급기타표기", "동의필수표기", // 파생 표기 필드 (2026-08-27)
]);

// 직원이 서명 시 직접 입력하는 필드는 화이트리스트('사유'류 자유서술)만 — 그 외 모든 필드는
// 관리자가 작성 시 입력. (교육평가시작 등 새 템플릿 필드가 직원에게 잘못 넘어가는 사고 방지)
// 사유류 자유서술 + 확인_ 체크(설명확인 등 — 직원이 서명하며 직접 체크하는 항목)
// 퇴사사유는 노무 이슈 방지를 위해 관리자(본사)가 작성 — 직원 입력에서 제외 (2026-08-25 디렉터 확정)
const EMPLOYEE_INPUT_EXCLUDE = new Set(["퇴사사유"]);
const EMPLOYEE_INPUT_PATTERN = /사유|^확인_|^주민등록번호$/; // 주민등록번호는 서명 시 본인 입력(민감정보)
const isEmployeeInputField = (name: string) =>
  !EMPLOYEE_INPUT_EXCLUDE.has(name) && EMPLOYEE_INPUT_PATTERN.test(name);

// 템플릿(.docx)에서 "직원이 서명 시 직접 입력하는" 문서 전용 필드 목록 반환.
// 화이트리스트(선사용사유 등 '사유'류·주민등록번호)만 직원 입력 — 퇴사사유는 관리자 작성 — 나머지는 전부 관리자 작성 폼에 표시.
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
        if (!isEmployeeInputField(name)) continue; // 화이트리스트 외 전부 관리자 입력 (퇴사사유는 관리자)
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
  // 값이 없으면(발송본·서명 전) 빈 체크 상태 — 사전 체크는 개인정보보호법 위반 (#104, 2026-08-27)
  if (choice === "동의") return "(☒ 동의함    □ 동의하지 않음)";
  if (choice === "미동의") return "(□ 동의함    ☒ 동의하지 않음)";
  return "(□ 동의함    □ 동의하지 않음)";
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
