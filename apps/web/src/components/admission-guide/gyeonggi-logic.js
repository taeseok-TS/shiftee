/* 2027학년도 경기도 고등학교 입학전형 기본계획 화면 스크립트 — 충남(EST) 화면(g-logic.js)의 run() 틀을 따른다:
 *  요소 찾기는 화면 틀(root) 안에서, 창·문서 리스너는 떠날 때 떼고, 인라인 처리기가 부르는 이름은 화면이 떠 있는 동안만 window 에, 문서 제목은 되돌린다.
 *  내신 계산은 「2027학년도 경기도 고등학교 입학 내신성적 반영지침」(2026.3) 그대로 — 계산 함수는 따로 내보내 node 로 시험한다.
 *  반올림은 지침대로 「소수 넷째 자리에서 반올림하여 셋째 자리까지」(학기별) — 부동소수 오차가 없게 정수(천분의 1) 연산으로 한다. */

// ─────────────────────────────────────────────
// 내신성적 계산 (반영지침 Ⅲ~Ⅵ)
// ─────────────────────────────────────────────

/** 학기 키 → [기본점수, 성취도 평균 계수×10, 원점수 평균 계수×100] (지침 <표-4>: 0.8/0.04, 1.6/0.08, 2/0.1) */
export const GEN_COEF = { s12: [4, 8, 4], s21: [8, 16, 8], s22: [8, 16, 8], s31: [10, 20, 10], s32: [10, 20, 10] };
export const SEM_KEYS = ["s12", "s21", "s22", "s31", "s32"];
export const SEM_LABEL = { s12: "1학년 2학기", s21: "2학년 1학기", s22: "2학년 2학기", s31: "3학년 1학기", s32: "3학년 2학기" };

/** 양수 분수 num/den 을 소수 셋째 자리까지 반올림한 값의 1000배(정수). num·den 은 정수 */
function roundThousandths(num, den) {
  return Math.floor((2 * num * 1000 + den) / (2 * den));
}

/** 학기 입력 확인 — 세 칸 모두 비면 null(그 학기 성적 없음), 일부만 있거나 범위를 벗어나면 { error } */
export function semEntry(ach, raw, n) {
  const blank = (v) => v === "" || v === null || v === undefined;
  if (blank(ach) && blank(raw) && blank(n)) return null;
  if (blank(ach) || blank(raw) || blank(n)) return { error: "성취도 합·원점수 합·과목수를 모두 넣어 주세요" };
  const a = Number(ach), r = Number(raw), c = Number(n);
  if (!Number.isInteger(c) || c < 1) return { error: "과목수는 1 이상의 정수입니다" };
  if (!Number.isInteger(a) || a < c || a > 5 * c) return { error: `성취도 합은 ${c}~${5 * c} 사이의 정수입니다(A=5…E=1)` };
  if (!Number.isFinite(r) || r < 0 || r > 100 * c) return { error: `원점수 합은 0~${100 * c} 사이입니다` };
  if (Math.abs(r * 100 - Math.round(r * 100)) > 1e-6) return { error: "원점수 합은 소수 둘째 자리까지 넣어 주세요" };
  return { ach: a, raw: r, n: c };
}

/** 일반교과 학기 점수(천분의 1 정수) = 기본 + (성취도 합÷과목수)×계수 + (원점수 합÷과목수)×계수, 소수 넷째 자리 반올림 */
export function generalSemesterThousandths(key, ach, raw, n) {
  const [base, k1, k2] = GEN_COEF[key];
  const raw100 = Math.round(raw * 100);
  const den = 10000 * n;
  const num = base * den + ach * k1 * 1000 + raw100 * k2;
  return roundThousandths(num, den);
}

/** 일반교과 학기 점수(소수 셋째 자리) */
export function generalSemesterScore(key, ach, raw, n) {
  return generalSemesterThousandths(key, ach, raw, n) / 1000;
}

/**
 * 성적이 한 과목도 없는 학기의 대체(지침 Ⅲ 유의사항 3 — 가, 나, 다 순) · 조기졸업자(유의사항 8).
 * sems: { s12, s21, s22, s31, s32 } 각 { ach, raw, n } 또는 null. 돌려줌: { sems, notes[], error }
 */
export function resolveSemesters(input, opts = {}) {
  const r = { ...input };
  const notes = [];
  const origin = {}; // 학기 → 실제 성적을 가져온 학기(대체가 이어질 때 원래 학기)
  const set = (k, src, rule) => {
    r[k] = r[src];
    origin[k] = origin[src] || src;
    notes.push(`${SEM_LABEL[k]} ← ${SEM_LABEL[origin[k]]} 성적(${rule})`);
  };
  // 가. 학년 내 한 학기가 없으면 다른 학기로
  if (!r.s21 && r.s22) set("s21", "s22", "유의사항 3-가");
  if (!r.s22 && r.s21) set("s22", "s21", "유의사항 3-가");
  if (opts.earlyGrad) {
    if (!r.s21) return { sems: r, notes, error: "조기졸업자는 2학년 성적이 있어야 3학년 성적을 정할 수 있습니다" };
    r.s31 = r.s21; origin.s31 = origin.s21 || "s21";
    r.s32 = r.s22; origin.s32 = origin.s22 || "s22";
    notes.push("3학년 1·2학기 ← 2학년 1·2학기 성적(조기졸업자, 유의사항 8)");
  } else {
    if (!r.s31 && r.s32) set("s31", "s32", "유의사항 3-가");
    if (!r.s32 && r.s31) set("s32", "s31", "유의사항 3-가");
    // 나. 학년 내 1, 2학기가 모두 없으면 차상위 학년을 기준으로 학기별로
    if (!r.s21 && !r.s22) {
      if (!r.s31) return { sems: r, notes, error: "2·3학년 일반교과 성적이 모두 없어 지침의 대체 순서로 정할 수 없습니다(학업성적관리위원회 심의 사항)" };
      set("s21", "s31", "유의사항 3-나");
      set("s22", "s32", "유의사항 3-나");
    }
    // 다. 차상위 학년도 없으면(3학년) 차하위 학년을 기준으로 학기별로
    if (!r.s31 && !r.s32) {
      set("s31", "s21", "유의사항 3-다");
      set("s32", "s22", "유의사항 3-다");
    }
  }
  // 나 단서. 1학년 2학기 성적이 없으면 2학년 1학기 성적으로
  if (!r.s12) {
    if (!r.s21) return { sems: r, notes, error: "일반교과 성적을 넣어 주세요" };
    set("s12", "s21", "유의사항 3-나 단서");
  }
  return { sems: r, notes, error: null };
}

/** 체육·예술 교과(천분의 1 정수) = 10 + 20 × (3a+2b+c) ÷ (3×이수 과목수). 한 과목도 없으면 10 + 20×1/3 = 16.667 (유의사항 11) */
export function artsThousandths(a, b, c) {
  const n = a + b + c;
  if (n === 0) return roundThousandths(10 * 3 + 20, 3); // 10 + 20/3
  const s = 3 * a + 2 * b + c;
  return roundThousandths(30 * n + 20 * s, 3 * n);
}

/** 학년별 미인정 결석 일수 = 미인정 결석 + ⌊미인정 지각·조퇴·결과 합계 ÷ 3⌋ (지침 Ⅳ-2) */
export function attendanceDays(absent, lateEtc) {
  return Math.max(0, Math.floor(absent)) + Math.floor(Math.max(0, Math.floor(lateEtc)) / 3);
}

/** <표-6> 학년별 출결 점수(소수 첫째 자리 ×10 정수). 1학년 6점, 2·3학년 7점 만점, 6일 이상 40% */
export const ATT_TABLE = { 1: [60, 54, 48, 42, 36, 30, 24], 2: [70, 63, 56, 49, 42, 35, 28], 3: [70, 63, 56, 49, 42, 35, 28] };
export function attendanceYearTenths(year, days) {
  return ATT_TABLE[year][Math.min(6, Math.max(0, days))];
}

/** <표-7> 봉사활동(3개년) — 15시간 이상 20점 … 7시간 이하 12점. 20점 부여 대상(지체장애인 봉사 불가자·국내수학기간 2년 미만자)은 20점 */
export function volunteerScore(hours, exempt = false) {
  if (exempt) return 20;
  const h = Math.floor(Math.max(0, hours));
  if (h >= 15) return 20;
  if (h <= 7) return 12;
  return h + 5;
}

/** 학교활동(×10 정수) = 기본 8점 + min(2, 수상 학기 수 × 0.5 + 자치회 임원 개월 수 × 0.1) (지침 Ⅵ) */
export function activityTenths(awardSemesters, officerMonths) {
  const extra = 5 * Math.max(0, Math.floor(awardSemesters)) + Math.max(0, Math.floor(officerMonths));
  return 80 + Math.min(20, extra);
}

/**
 * 200점 내신 전체 계산.
 * input = { sems:{s12..s32: {ach,raw,n}|null}, earlyGrad, arts:{a,b,c}|null, att:[{abs,late}×3], vol:{hours|null, exempt}, act:{awards, months} }
 * 값은 모두 소수 셋째 자리 수(number). 산출할 수 없는 항목은 null.
 */
export function calcNaesin(input) {
  const res = { sem: {}, gen: null, arts: null, subject: null, attYears: [], att: null, vol: null, act: null, total: null, notes: [], error: null };
  const rs = resolveSemesters(input.sems, { earlyGrad: !!input.earlyGrad });
  res.notes = rs.notes;
  let genT = null;
  if (rs.error) res.error = rs.error;
  else {
    genT = 0;
    for (const k of SEM_KEYS) {
      const e = rs.sems[k];
      const t = generalSemesterThousandths(k, e.ach, e.raw, e.n);
      res.sem[k] = t / 1000;
      genT += t;
    }
    res.gen = genT / 1000;
  }
  const artT = input.arts ? artsThousandths(input.arts.a, input.arts.b, input.arts.c) : null;
  res.arts = artT === null ? null : artT / 1000;
  const subjT = genT !== null && artT !== null ? genT + artT : null;
  res.subject = subjT === null ? null : subjT / 1000;
  let attTenths = 0;
  input.att.forEach((y, i) => {
    const t = attendanceYearTenths(i + 1, attendanceDays(y.abs, y.late));
    res.attYears.push(t / 10);
    attTenths += t;
  });
  res.att = attTenths / 10;
  res.vol = input.vol.exempt || input.vol.hours !== null ? volunteerScore(input.vol.hours || 0, input.vol.exempt) : null;
  const actT = activityTenths(input.act.awards, input.act.months);
  res.act = actT / 10;
  if (subjT !== null && res.vol !== null) res.total = (subjT + attTenths * 100 + res.vol * 1000 + actT * 100) / 1000;
  return res;
}

// ─────────────────────────────────────────────
// 졸업생 평어·석차 → 원점수 (지침 Ⅲ 유의사항 5)
// ─────────────────────────────────────────────
export const RANK_RANGE = { 수: [90, Infinity], 우: [80, 89], 미: [70, 79], 양: [60, 69], 가: [-Infinity, 59] };
export const GRADE_TO_ACH = { 수: "A", 우: "B", 미: "C", 양: "D", 가: "E" };

/** 환산점수 T = 100×{1 − (석차/수강자수)}, 소수점 아래 첫째 자리에서 반올림. T 가 평어 범위 밖이면 기준점수 */
export function rawFromRank(grade, rank, total) {
  if (!RANK_RANGE[grade] || !Number.isInteger(rank) || !Number.isInteger(total) || rank < 1 || total < 1 || rank > total) return null;
  const T = Math.floor((200 * (total - rank) + total) / (2 * total));
  const [lo, hi] = RANK_RANGE[grade];
  let raw = T, rule = "환산점수(T)를 원점수로 부여";
  if (T < lo) { raw = lo; rule = `T<${lo} → 기준점수 ${lo}점`; }
  else if (T > hi) { raw = hi; rule = `T≥${hi + 1} → 기준점수 ${hi}점`; }
  return { T, raw, rule, ach: GRADE_TO_ACH[grade] };
}

/** 원점수는 있으나 성취도가 없는 일반교과의 환산 성취도 (지침 Ⅲ-6) */
export function achievementFromRaw(t) {
  if (t >= 90) return "A";
  if (t >= 80) return "B";
  if (t >= 70) return "C";
  if (t >= 60) return "D";
  return "E";
}

// ─────────────────────────────────────────────
// 외고·국제고 1단계 영어 내신성적 (기본계획 p.11)
// ─────────────────────────────────────────────
export const ENG_POINTS = { A: 40, B: 36, C: 32, D: 28, E: 24 };
/** 중학교 2, 3학년 4개 학기 영어 환산점수의 합(160점). 네 학기가 다 있어야 계산 */
export function englishStage1(levels) {
  if (levels.length !== 4 || levels.some((l) => !ENG_POINTS[l])) return null;
  return levels.reduce((s, l) => s + ENG_POINTS[l], 0);
}

// ─────────────────────────────────────────────
// 날짜 (D-day 는 한국 시간 기준)
// ─────────────────────────────────────────────
export function seoulToday(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
export function dayDiff(from, to) {
  const p = (s) => { const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((p(to) - p(from)) / 86400000);
}
/** 다음 한국 시간 자정까지 남은 ms (한국은 일광절약시간 없음 = UTC+9) */
export function msUntilSeoulMidnight(now = new Date()) {
  const [y, m, d] = seoulToday(now).split("-").map(Number);
  return Date.UTC(y, m - 1, d + 1) - 9 * 3600000 - now.getTime();
}
/**
 * 「다음 주요 일정」 고르기. events: [{ start, end, ref }] (ref = 참고 일정 — 고르지 않음).
 * 순서: 오늘 시작(D-DAY) → 기간 진행 중 → 가장 가까운 예정(같으면 앞 항목). 돌려줌 { index, kind: today|ongoing|upcoming, diff } 또는 null
 */
export function pickNextEvent(events, today) {
  let todayIdx = -1, ongoingIdx = -1, nextIdx = -1, nextDiff = Infinity;
  events.forEach((e, i) => {
    if (e.ref) return;
    const toStart = dayDiff(today, e.start), toEnd = dayDiff(today, e.end || e.start);
    if (toEnd < 0) return;
    if (toStart === 0) { if (todayIdx < 0) todayIdx = i; return; }
    if (toStart < 0) { if (ongoingIdx < 0) ongoingIdx = i; return; }
    if (toStart < nextDiff) { nextDiff = toStart; nextIdx = i; }
  });
  if (todayIdx >= 0) return { index: todayIdx, kind: "today", diff: 0 };
  if (ongoingIdx >= 0) return { index: ongoingIdx, kind: "ongoing", diff: 0 };
  if (nextIdx >= 0) return { index: nextIdx, kind: "upcoming", diff: nextDiff };
  return null;
}

// ─────────────────────────────────────────────
// 화면
// ─────────────────────────────────────────────
export function run(__root, INPUT, host, __ctx = {}) {
  void INPUT; void host; void __ctx;
  const __byId = (id) => __root.querySelector("#" + CSS.escape(id));
  const offs = [];
  let __dead = false;
  const on = (target, type, fn, opts) => { if (__dead || !target) return; target.addEventListener(type, fn, opts); offs.push(() => target.removeEventListener(type, fn, opts)); };
  const __globals = new Map();
  const __defGlobal = (k, get) => {
    if (!__globals.has(k)) __globals.set(k, Object.getOwnPropertyDescriptor(window, k));
    Object.defineProperty(window, k, { get, set: () => {}, configurable: true, enumerable: true });
  };
  const __prevTitle = document.title;
  document.title = "2027학년도 경기도 고등학교 입학전형 기본계획";

  // 섹션 전환
  const navLinks = __root.querySelectorAll(".nav-link");
  const sections = __root.querySelectorAll(".section");
  function showSection(targetId) {
    sections.forEach((s) => s.classList.remove("active"));
    navLinks.forEach((n) => n.classList.remove("active"));
    const target = __byId("section-" + targetId);
    if (target) target.classList.add("active");
    const link = __root.querySelector(`.nav-link[data-target="${targetId}"]`);
    if (link) link.classList.add("active");
    window.scrollTo({ top: 0, behavior: "smooth" });
    if (window.innerWidth <= 768) {
      __byId("sidebar").classList.remove("open");
      __root.querySelector(".sidebar-backdrop").classList.remove("show");
    }
    updateFloatHome();
  }
  navLinks.forEach((link) => on(link, "click", (e) => { e.preventDefault(); showSection(link.dataset.target); }));
  __root.querySelectorAll(".quick-card").forEach((card) => on(card, "click", () => showSection(card.dataset.target)));

  function toggleSidebar() {
    __byId("sidebar").classList.toggle("open");
    __root.querySelector(".sidebar-backdrop").classList.toggle("show");
  }

  // 검색
  const searchIndex = [
    { label: "메인", target: "home", keywords: ["홈", "메인", "변경사항", "문의", "원문"] },
    { label: "목적·방침", target: "overview", keywords: ["목적", "방침", "이중지원", "전기", "후기", "입학전형위원회"] },
    { label: "전형 일정(원문 표)", target: "calendar", keywords: ["일정", "원서접수", "합격자 발표", "배정 학교 발표", "수능"] },
    { label: "평준화지역 일반고", target: "equal", keywords: ["평준화", "지원 자격", "거주", "선복수 지원", "체육특기자", "자율형 공립고"] },
    { label: "비평준화지역 일반고", target: "nonequal", keywords: ["비평준화", "학교별 전형", "특별전형 10%", "체육특기자 5%"] },
    { label: "특성화고", target: "vocational", keywords: ["특성화고", "추천입학제", "교육감 지정", "진로적성", "취업희망자", "일반고 특성화학과", "북한이탈"] },
    { label: "자율형 사립고", target: "autonomous", keywords: ["자사고", "자율형 사립고", "자기주도학습전형", "추첨", "면접"] },
    { label: "특수목적고", target: "special", keywords: ["외고", "외국어고", "국제고", "과학고", "예술고", "체육고", "마이스터고", "영어 내신", "외국인 유학생", "영재학교"] },
    { label: "추가모집·추가전형", target: "addition", keywords: ["추가모집", "전기학교 추가모집", "검정고시", "추가전형", "수시"] },
    { label: "국가유공자·특례입학", target: "exception", keywords: ["국가유공자", "교육지원대상자", "특례입학", "귀국학생", "영향평가"] },
    { label: "학교 배정 방법", target: "placement", keywords: ["배정", "학군내배정", "구역내배정", "추첨", "기점", "간격수", "출신구역", "쌍둥이", "세 자녀", "교직원 자녀", "선배정", "지체장애인"] },
    { label: "사회통합전형", target: "social", keywords: ["사회통합", "기회균등", "사회다양성", "1순위", "2순위", "3순위", "중위소득"] },
    { label: "전형 일정 · D-day", target: "schedule", keywords: ["D-day", "디데이", "일정", "타임라인"] },
    { label: "내신성적 산출", target: "grade", keywords: ["내신", "계산기", "200점", "성취도", "원점수", "출결", "봉사", "학교활동", "수상", "자치회", "동점자", "평어", "석차", "영어 160"] },
    { label: "평준화 학군 고교 현황", target: "schools", keywords: ["학교 목록", "고교 현황", "수원", "성남", "안양", "부천", "고양", "광명", "안산", "의정부", "용인"] },
    { label: "자주 묻는 질문", target: "faq", keywords: ["질문", "FAQ", "상담", "전학"] },
    { label: "유의사항·문의", target: "notice", keywords: ["유의", "이중지원", "문의", "전화", "포털"] },
  ];
  function openSearch() {
    __byId("searchOverlay").classList.add("show");
    setTimeout(() => { if (!__dead) __byId("searchInput").focus(); }, 100);
  }
  function closeSearch() {
    __byId("searchOverlay").classList.remove("show");
    __byId("searchInput").value = "";
    __byId("searchResults").innerHTML = "";
  }
  function doSearch() {
    const q = __byId("searchInput").value.trim().toLowerCase();
    const results = __byId("searchResults");
    if (!q) { results.innerHTML = ""; return; }
    const matched = searchIndex.filter((item) => item.label.toLowerCase().includes(q) || item.keywords.some((k) => k.toLowerCase().includes(q)));
    if (matched.length === 0) {
      results.innerHTML = '<div style="padding:24px;text-align:center;color:var(--muted);font-size:13px;">일치하는 결과가 없습니다.</div>';
      return;
    }
    results.innerHTML = matched.map((m) => `<div class="search-result-item" onclick="showSection('${m.target}');closeSearch();"><span class="label">${m.label}</span><span>${m.keywords.slice(0, 4).join(" · ")}</span></div>`).join("");
  }
  on(document, "keydown", (e) => {
    if (e.key === "Escape") closeSearch();
    if ((e.ctrlKey || e.metaKey) && e.key === "k") { e.preventDefault(); openSearch(); }
  });

  // 전형 일정 필터 + D-day (한국 시간 오늘)
  const filterBtns = __root.querySelectorAll(".timeline-filter .filter-btn");
  filterBtns.forEach((btn) => on(btn, "click", () => {
    filterBtns.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    const f = btn.dataset.filter;
    __root.querySelectorAll(".timeline-event").forEach((ev) => {
      ev.style.display = f === "all" || ev.dataset.cat === f || ev.dataset.cat === "all" ? "grid" : "none";
    });
    __root.querySelectorAll(".timeline-month").forEach((month) => {
      const visible = Array.from(month.querySelectorAll(".timeline-event")).some((e) => e.style.display !== "none");
      month.style.display = visible ? "grid" : "none";
    });
  }));
  let ddayTimer = null;
  function updateDDay() {
    if (__dead) return;
    const today = seoulToday();
    const evs = Array.from(__root.querySelectorAll(".timeline-event")).filter((ev) => ev.dataset.date);
    evs.forEach((ev) => {
      const start = ev.dataset.date, end = ev.dataset.end || start;
      ev.classList.remove("passed", "upcoming");
      const toStart = dayDiff(today, start), toEnd = dayDiff(today, end);
      if (toEnd < 0) ev.classList.add("passed");
      else if (toStart <= 14) ev.classList.add("upcoming");
    });
    const pick = pickNextEvent(evs.map((ev) => ({ start: ev.dataset.date, end: ev.dataset.end || ev.dataset.date, ref: ev.dataset.ref === "1" })), today);
    const small = __byId("ddaySmall");
    if (pick) {
      const ev = evs[pick.index];
      __byId("ddayEvent").textContent = ev.querySelector(".te-content strong").textContent;
      __byId("ddayDate").textContent = ev.querySelector(".te-date").childNodes[0].textContent.trim();
      __byId("ddayCount").textContent = pick.kind === "today" ? "D-DAY" : pick.kind === "ongoing" ? "진행 중" : "D-" + pick.diff;
      if (small) small.textContent = pick.kind === "upcoming" ? "DAYS LEFT" : "TODAY";
    } else {
      __byId("ddayEvent").textContent = "예정된 일정이 없습니다";
      __byId("ddayDate").textContent = "—";
      __byId("ddayCount").textContent = "—";
    }
    // 한국 시간 자정이 지나면 다시 계산(떠날 때 타이머 해제)
    if (ddayTimer) clearTimeout(ddayTimer);
    ddayTimer = setTimeout(updateDDay, msUntilSeoulMidnight() + 1000);
  }
  updateDDay();

  // 서브탭
  function switchSubTab(btn, targetId) {
    btn.parentElement.querySelectorAll(".sub-nav-item").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    const section = btn.closest(".section");
    section.querySelectorAll(".subtab-content").forEach((c) => c.classList.remove("active"));
    const target = section.querySelector("#" + CSS.escape(targetId));
    if (target) target.classList.add("active");
  }

  // 내신 계산기
  const val = (id) => { const el = __byId(id); return el ? el.value.trim() : ""; };
  const num0 = (id) => { const v = Number(val(id)); return Number.isFinite(v) && v > 0 ? v : 0; };
  const f3 = (v) => (v === null || v === undefined ? "—" : v.toFixed(3));
  const setText = (id, t) => { const el = __byId(id); if (el) el.textContent = t; };
  function calculate() {
    const sems = {};
    const errors = [];
    for (const k of SEM_KEYS) {
      const p = "g" + k.slice(1);
      const e = semEntry(val(p + "-ach"), val(p + "-raw"), val(p + "-n"));
      if (e && e.error) { errors.push(`${SEM_LABEL[k]}: ${e.error}`); sems[k] = null; }
      else sems[k] = e;
    }
    const early = !!(__byId("g-early") && __byId("g-early").checked);
    const artBlank = ["art-a", "art-b", "art-c"].every((id) => val(id) === "");
    const arts = artBlank ? null : { a: Math.floor(num0("art-a")), b: Math.floor(num0("art-b")), c: Math.floor(num0("art-c")) };
    const att = [1, 2, 3].map((y) => ({ abs: num0(`att${y}-abs`), late: num0(`att${y}-late`) }));
    const volExempt = !!(__byId("vol-exempt") && __byId("vol-exempt").checked);
    const vol = { hours: val("vol-hours") === "" ? null : num0("vol-hours"), exempt: volExempt };
    const act = { awards: num0("act-award"), months: num0("act-month") };
    const r = calcNaesin({ sems, earlyGrad: early, arts, att, vol, act });
    const gErr = __byId("gError");
    const shownErr = errors.length ? errors.join(" · ") : SEM_KEYS.every((k) => !sems[k]) ? "" : r.error || "";
    if (gErr) { gErr.textContent = shownErr; gErr.style.display = shownErr ? "block" : "none"; }
    const genOk = !errors.length && !r.error;
    for (const k of SEM_KEYS) setText(k, genOk ? f3(r.sem[k]) : "—");
    setText("sGen", genOk ? f3(r.gen) : "—");
    setText("sArt", f3(r.arts));
    setText("subjectTotal", genOk ? f3(r.subject) : "—");
    setText("attTotal", r.att.toFixed(1));
    setText("attYears", r.attYears.map((v) => v.toFixed(1)).join(" / "));
    setText("volTotal", r.vol === null ? "—" : String(r.vol));
    setText("actTotal", r.act.toFixed(1));
    const total = genOk ? r.total : null;
    setText("totalScore", f3(total));
    const missing = [];
    if (!genOk || SEM_KEYS.every((k) => !sems[k])) missing.push("일반교과");
    if (r.arts === null) missing.push("체육·예술");
    if (r.vol === null) missing.push("봉사");
    setText("totalReason", total === null && missing.length ? `${missing.join("·")} 칸을 모두 채우면 총점이 나옵니다` : "");
    const bar = __byId("scoreBar");
    if (bar) bar.style.width = (total === null ? 0 : Math.min(100, (total / 200) * 100)) + "%";
    const note = __byId("substNote");
    if (note) note.textContent = genOk && r.notes.length ? "대체 적용: " + r.notes.join(" / ") : "";
  }
  const calcIds = [
    ...SEM_KEYS.flatMap((k) => ["-ach", "-raw", "-n"].map((s) => "g" + k.slice(1) + s)),
    "g-early", "art-a", "art-b", "art-c", "att1-abs", "att1-late", "att2-abs", "att2-late", "att3-abs", "att3-late",
    "vol-hours", "vol-exempt", "act-award", "act-month",
  ];
  calcIds.forEach((id) => {
    const el = __byId(id);
    on(el, "input", calculate);
    on(el, "change", calculate);
  });
  calculate();

  // 졸업생 평어·석차 → 원점수
  function calcRank() {
    const rank = Number(val("rk-rank")), total = Number(val("rk-total"));
    const out = val("rk-rank") && val("rk-total") ? rawFromRank(val("rk-grade"), rank, total) : null;
    setText("rkRaw", out ? String(out.raw) : "—");
    setText("rkT", out ? String(out.T) : val("rk-rank") && val("rk-total") ? "석차·수강자수 확인" : "—");
    setText("rkRule", out ? out.rule : "—");
    setText("rkAch", out ? out.ach : "—");
  }
  ["rk-grade", "rk-rank", "rk-total"].forEach((id) => { on(__byId(id), "input", calcRank); on(__byId(id), "change", calcRank); });
  calcRank();

  // 외고·국제고 1단계 영어
  function calcEng() {
    const levels = ["eng-21", "eng-22", "eng-31", "eng-32"].map(val);
    const t = englishStage1(levels);
    setText("engTotal", t === null ? "—" : String(t));
    const bar = __byId("engBar");
    if (bar) bar.style.width = (t === null ? 0 : (t / 160) * 100) + "%";
  }
  ["eng-21", "eng-22", "eng-31", "eng-32"].forEach((id) => on(__byId(id), "change", calcEng));
  calcEng();

  // 학교 검색·학군 필터
  let currentSchoolFilter = "all";
  function filterSchools() {
    const q = __byId("schoolSearch").value.trim().toLowerCase();
    __root.querySelectorAll("#schoolsList .school-category").forEach((cat) => {
      const chips = cat.querySelectorAll(".school-chip");
      if (currentSchoolFilter !== "all" && cat.dataset.cat !== currentSchoolFilter) { cat.style.display = "none"; return; }
      if (!q) { cat.style.display = ""; chips.forEach((c) => { c.style.outline = ""; }); return; }
      let any = false;
      chips.forEach((chip) => {
        if (chip.textContent.toLowerCase().includes(q)) { chip.style.outline = "2px solid var(--gold)"; chip.style.outlineOffset = "-2px"; any = true; }
        else chip.style.outline = "";
      });
      const titleHit = cat.querySelector(".school-category-title").textContent.toLowerCase().includes(q);
      cat.style.display = any || titleHit ? "" : "none";
    });
  }
  function setSchoolFilter(btn, filter) {
    btn.parentElement.querySelectorAll("[data-school-filter]").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    currentSchoolFilter = filter;
    filterSchools();
  }

  // FAQ
  function toggleFAQ(item) { item.classList.toggle("open"); }

  // 플로팅 메인 버튼
  const floatHome = __byId("floatHome");
  let floatHomeTimer = null;
  function updateFloatHome() {
    if (!floatHome) return;
    const home = __byId("section-home");
    const onHome = home && home.classList.contains("active");
    floatHome.classList.toggle("show", !onHome && window.scrollY > 300);
  }
  on(window, "scroll", () => {
    if (floatHomeTimer) return;
    floatHomeTimer = setTimeout(() => { floatHomeTimer = null; if (!__dead) updateFloatHome(); }, 100);
  }, { passive: true });
  updateFloatHome();

  // 인라인 처리기(onclick="…")가 부르는 이름 — 화면이 떠 있는 동안만 window 에
  const __expose = { showSection, toggleSidebar, openSearch, closeSearch, doSearch, switchSubTab, toggleFAQ, filterSchools, setSchoolFilter };
  for (const k in __expose) __defGlobal(k, () => __expose[k]);

  return () => {
    __dead = true;
    if (floatHomeTimer) clearTimeout(floatHomeTimer);
    if (ddayTimer) clearTimeout(ddayTimer);
    offs.forEach((f) => f());
    for (const [k, prev] of __globals) { delete window[k]; if (prev) Object.defineProperty(window, k, prev); }
    document.title = __prevTitle;
  };
}
