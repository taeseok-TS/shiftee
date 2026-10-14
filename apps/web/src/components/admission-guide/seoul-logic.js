/* 2027학년도 서울특별시 고등학교 입학전형 기본계획 화면 스크립트 — 충남 화면(chungnam_admission/g-logic.js)의 run() 틀을 따른다:
 *  요소 찾기는 화면 틀(root) 안에서, 창·문서 리스너는 떠날 때 떼고, 인라인 처리기가 부르는 이름은 화면이 떠 있는 동안만 window 에, 문서 제목은 되돌린다.
 *  계산식은 원문 「고입전형을 위한 중학교 성적 산출 지침」(붙임 3, p.25~32)을 그대로 옮긴 순수 함수로 밖에 내보낸다(조견표 대조 검사용). */

// ========================================
// 순수 계산 함수 (원문 붙임 3)
// ========================================

const isCount = (x) => Number.isInteger(x) && x >= 0;

/** 정수 a/b 를 소수 셋째 자리까지 반올림(넷째 자리에서 반올림)한 값 — a, b 는 정수, b > 0. 부동소수 오차 없이 정수로 계산 */
function roundRatio3(a, b) {
  return Math.floor((2 * a * 1000 + b) / (2 * b)) / 1000;
}

/** 교과 점수 = (1 − 최하위 성취도 과목수 ÷ 총 이수 과목수) × 80, 소수점 아래 넷째 자리에서 반올림하여 셋째 자리까지.
 *  1학기 이상 이수한 과목 수가 없으면 0점. 잘못된 입력(음수·소수·최하위 > 총 이수)은 null */
export function seoulSubjectScore(totalSubjects, lowestSubjects) {
  if (!isCount(totalSubjects) || !isCount(lowestSubjects) || lowestSubjects > totalSubjects) return null;
  if (totalSubjects === 0) return 0;
  return roundRatio3(80 * (totalSubjects - lowestSubjects), totalSubjects);
}

/** 한 학년의 결석일수 = 미인정 결석 + ⌊(미인정 지각 + 조퇴 + 결과) ÷ 3⌋ (학년별로 3회 = 1일, 2회 이하 버림). 잘못된 입력은 null */
export function seoulYearAbsenceDays(absent, late, earlyLeave, skipped) {
  if (![absent, late, earlyLeave, skipped].every(isCount)) return null;
  return absent + Math.floor((late + earlyLeave + skipped) / 3);
}

/** 조기진급·조기졸업(예정)자의 조정 결석일수 = 실제 결석일수 × 3 ÷ Y (Y = 실제 이수 학년수), 소수점 아래 첫째 자리에서 반올림하여 정수. Y = 3 이면 실제 결석일수 그대로 */
export function seoulAdjustedAbsenceDays(actualDays, years) {
  if (!isCount(actualDays) || ![1, 2, 3].includes(years)) return null;
  if (years === 3) return actualDays;
  return Math.floor((6 * actualDays + years) / (2 * years));
}

/** 출결 점수 = 20 − (결석일수 × 0.2), 100일 이상 결석 시 100일로 간주 → 0.0~20.0 */
export function seoulAttendanceScore(absenceDays) {
  if (!isCount(absenceDays)) return null;
  const d = Math.min(absenceDays, 100);
  return (200 - 2 * d) / 10;
}

/** 고입전형 총점(100점) = 교과 점수 + 출결 점수 */
export function seoulTotalScore(subjectScore, attendanceScore) {
  if (subjectScore == null || attendanceScore == null) return null;
  return Math.round(subjectScore * 1000 + attendanceScore * 1000) / 1000;
}

/** 중졸 검정고시 합격자의 중학교 성적 환산 점수 = (1 − 60점 미만 과목수 ÷ 총 응시 과목수) × 100, 넷째 자리에서 반올림하여 셋째 자리까지 */
export function seoulGedScore(totalSubjects, below60) {
  if (!isCount(totalSubjects) || totalSubjects === 0 || !isCount(below60) || below60 > totalSubjects) return null;
  return roundRatio3(100 * (totalSubjects - below60), totalSubjects);
}

/** 서울 기준 오늘 날짜(YYYY-MM-DD) */
export function seoulToday(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

const dayNumber = (ymd) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86400000;
};

/** 일정 한 줄의 D-day 상태 — start~end(같으면 하루) 와 오늘(YYYY-MM-DD).
 *  passed: 끝남 / today: 오늘 시작(D-DAY) / ongoing: 시작일이 지났고 아직 진행 중 / upcoming: diff 일 남음 */
export function seoulDday(start, end, today) {
  const t = dayNumber(today), s = dayNumber(start), e = dayNumber(end || start);
  if (e < t) return { state: "passed", diff: e - t };
  if (s === t) return { state: "today", diff: 0 };
  if (s < t) return { state: "ongoing", diff: 0 };
  return { state: "upcoming", diff: s - t };
}

/** 지금부터 다음 서울 자정(00:00 KST)까지 남은 ms — 서울은 UTC+9 고정(서머타임 없음) */
export function msUntilSeoulMidnight(nowMs = Date.now()) {
  const DAY = 86400000;
  return DAY - ((nowMs + 9 * 3600000) % DAY);
}

// ========================================
// 화면
// ========================================

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- 공통 run() 서명(EstStaticPage 가 자료·틀·ctx 를 넘긴다). 이 화면은 자료 파일·ctx 를 쓰지 않는다
export function run(__root, INPUT, host, __ctx = {}) {
  const __byId = (id) => __root.querySelector("#" + CSS.escape(id));
  const offs = [];
  let __dead = false; // 떠난 뒤에는 리스너를 새로 걸지 않는다
  const on = (target, type, fn, opts) => {
    if (__dead || !target) return;
    target.addEventListener(type, fn, opts);
    offs.push(() => target.removeEventListener(type, fn, opts));
  };
  const __globals = new Map(); // 이름 → 원래 window 속성(없으면 undefined) — 떠날 때 되돌린다
  const __defGlobal = (k, get) => {
    if (!__globals.has(k)) __globals.set(k, Object.getOwnPropertyDescriptor(window, k));
    Object.defineProperty(window, k, { get, set: () => {}, configurable: true, enumerable: true });
  };
  const __prevTitle = document.title;
  const timers = [];

  // ---------- 섹션 전환 ----------
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

  // ---------- 검색 ----------
  const searchIndex = [
    { label: "메인", target: "home", keywords: ["홈", "메인", "시작", "변경", "예고", "담당 부서", "문의"] },
    { label: "개요·기본방침", target: "overview", keywords: ["목적", "기본 방침", "전기", "후기", "학교 유형", "학교수", "공고"] },
    { label: "지원 자격", target: "eligibility", keywords: ["자격", "거주", "주민등록", "졸업예정자", "검정고시", "모집단위", "재입학"] },
    { label: "전기학교 전형", target: "early", keywords: ["과학고", "영재학교", "예술고", "서울미술고", "체육고", "서울체육고", "마이스터고", "특성화고", "미래인재", "관악예술과", "염광고", "서울반도체고"] },
    { label: "후기학교 전형", target: "late", keywords: ["교육감 선발", "일반고", "과학중점", "예술·체육중점", "외국어고", "국제고", "자사고", "자율형 사립고", "하나고", "한광고", "한국삼육고", "원서 제출처"] },
    { label: "학교 배정 방법", target: "placement", keywords: ["고교선택제", "선 지원 후 추첨", "단일학교군", "일반학교군", "통합학교군", "학교군", "특이 배정", "쌍둥이", "다자녀", "입학전 배정", "교직원 자녀"] },
    { label: "특별학생 및 추가전형", target: "special", keywords: ["특례", "특수교육", "보훈", "체육특기자", "외국인 유학생", "근거리 통학", "사회통합", "추가전형"] },
    { label: "전형 일정", target: "schedule", keywords: ["일정", "원서 접수", "합격자 발표", "배정학교 발표", "입학 등록", "추가모집", "D-day"] },
    { label: "내신성적 산출", target: "grade", keywords: ["내신", "성적", "교과 점수", "출결", "결석", "지각", "조퇴", "결과", "조견표", "별표", "동점자", "검정고시", "계산기", "기준일"] },
    { label: "제출 서류", target: "documents", keywords: ["서류", "제출", "자기소개서", "교사추천서", "학교생활기록부", "배제 사항", "체크리스트"] },
    { label: "자주 묻는 질문", target: "faq", keywords: ["질문", "FAQ"] },
    { label: "유의사항", target: "notice", keywords: ["이중지원", "예외", "거주사실", "가거주", "위장전입", "성적 관리", "원서입력 오류"] },
  ];

  function openSearch() {
    __byId("searchOverlay").classList.add("show");
    timers.push(setTimeout(() => __byId("searchInput").focus(), 100));
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
    results.innerHTML = matched
      .map((m) => `<div class="search-result-item" onclick="showSection('${m.target}');closeSearch();">
        <span class="label">${m.label}</span>
        <span>${m.keywords.slice(0, 4).join(" · ")}</span>
      </div>`)
      .join("");
  }

  on(document, "keydown", (e) => {
    if (e.key === "Escape") closeSearch();
    if ((e.ctrlKey || e.metaKey) && e.key === "k") { e.preventDefault(); openSearch(); }
  });

  // ---------- 전형 일정: 필터 + D-day(서울 기준 오늘) ----------
  const filterBtns = __root.querySelectorAll(".timeline-filter .filter-btn");
  filterBtns.forEach((btn) => on(btn, "click", () => {
    filterBtns.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    const filter = btn.dataset.filter;
    __root.querySelectorAll(".timeline-event").forEach((ev) => {
      const cats = (ev.dataset.cat || "").split(" ");
      ev.style.display = filter === "all" || cats.includes(filter) ? "grid" : "none";
    });
    __root.querySelectorAll(".timeline-month").forEach((month) => {
      const visible = Array.from(month.querySelectorAll(".timeline-event")).some((e) => e.style.display !== "none");
      month.style.display = visible ? "grid" : "none";
    });
  }));

  function updateDDay() {
    const today = seoulToday();
    let next = null;
    __root.querySelectorAll(".timeline-event").forEach((ev) => {
      ev.classList.remove("passed", "upcoming");
      if (!ev.dataset.date) return;
      const st = seoulDday(ev.dataset.date, ev.dataset.end, today);
      if (st.state === "passed") { ev.classList.add("passed"); return; }
      if (st.diff <= 14) ev.classList.add("upcoming");
      // 같은 날(diff 0)에 진행 중 일정과 오늘 시작 일정이 겹치면 오늘 시작(D-DAY)을 앞세운다
      if (!next || st.diff < next.st.diff || (st.diff === next.st.diff && st.state === "today" && next.st.state !== "today")) next = { ev, st };
    });
    const evEl = __byId("ddayEvent"), dateEl = __byId("ddayDate"), countEl = __byId("ddayCount"), unitEl = __byId("ddayUnit");
    if (!next) {
      evEl.textContent = "예정된 일정이 없습니다";
      dateEl.textContent = "—";
      countEl.textContent = "—";
      return;
    }
    const dateNode = next.ev.querySelector(".te-date");
    evEl.textContent = next.ev.querySelector(".te-content strong").textContent;
    dateEl.textContent = `${dateNode.childNodes[0].textContent.trim()} (${dateNode.querySelector("small").textContent})`;
    if (next.st.state === "ongoing") {
      countEl.textContent = "진행 중";
      unitEl.textContent = "IN PROGRESS";
    } else if (next.st.state === "today") {
      countEl.textContent = "D-DAY";
      unitEl.textContent = "TODAY";
    } else {
      countEl.textContent = "D-" + next.st.diff;
      unitEl.textContent = "DAYS LEFT";
    }
  }
  updateDDay();
  // 화면을 띄워 둔 채 날짜가 바뀌면(서울 자정) 다시 계산 — 떠날 때 타이머를 지운다
  let midnightTimer = null;
  const scheduleMidnight = () => {
    midnightTimer = setTimeout(() => {
      if (__dead) return;
      updateDDay();
      scheduleMidnight();
    }, msUntilSeoulMidnight() + 1000);
  };
  scheduleMidnight();

  // ---------- 고입전형 총점 계산기 ----------
  // 빈 칸 = 0. 숫자가 아닌 값(브라우저가 value 를 "" 로 돌려주는 badInput)은 0 으로 치지 않고 NaN → 오류 표시
  const isBad = (el) => !!(el && el.validity && el.validity.badInput);
  const isBlank = (id) => {
    const el = __byId(id);
    return !el || (el.value.trim() === "" && !isBad(el));
  };
  const readCount = (id) => {
    const el = __byId(id);
    if (isBad(el)) return NaN;
    const v = el ? el.value.trim() : "";
    return v === "" ? 0 : Number(v);
  };
  const SUBJECT_IDS = ["sbj-2-1", "sbj-2-2", "sbj-3-1", "sbj-3-2"];
  const ATT_PARTS = ["abs", "late", "early", "skip"];

  function calculate() {
    const errors = [];
    const sems = SUBJECT_IDS.map(readCount);
    const low = readCount("sbj-low");
    let subject = null;
    let total = null;
    // 교과 칸 5개가 모두 비어 있으면 아직 입력 전 — 0과목(0점)으로 치지 않고 「—」. 0 을 직접 넣으면 원문대로 0점
    const subjectBlank = [...SUBJECT_IDS, "sbj-low"].every(isBlank);
    if (subjectBlank) { /* 입력 전 */ }
    else if (![...sems, low].every(isCount)) errors.push("과목수는 0 이상의 정수로 입력하세요.");
    else {
      total = sems.reduce((a, b) => a + b, 0);
      subject = seoulSubjectScore(total, low);
      if (subject === null) errors.push("최하위 성취도 과목수는 총 이수 과목수보다 클 수 없습니다.");
    }

    const yearDays = [1, 2, 3].map((y) => {
      const [abs, late, early, skip] = ATT_PARTS.map((p) => readCount(`att-${y}-${p}`));
      return seoulYearAbsenceDays(abs, late, early, skip);
    });
    let att = null, sum = null, adj = null;
    const years = Number(__byId("att-years").value);
    if (yearDays.some((d) => d === null)) errors.push("결석·지각·조퇴·결과는 0 이상의 정수로 입력하세요.");
    else {
      sum = yearDays.reduce((a, b) => a + b, 0);
      adj = seoulAdjustedAbsenceDays(sum, years);
      att = seoulAttendanceScore(adj);
    }

    const errEl = __byId("calcError");
    errEl.textContent = errors.join(" ");
    errEl.classList.toggle("show", errors.length > 0);

    __byId("subjectCount").textContent = total === null ? "—" : String(total);
    __byId("subjectLow").textContent = !subjectBlank && isCount(low) ? String(low) : "—";
    __byId("subjectScore").textContent = subject === null ? "—" : subject.toFixed(3);
    __byId("attYears").textContent = yearDays.map((d) => (d === null ? "—" : d)).join(" · ");
    __byId("attSum").textContent = sum === null ? "—" : String(sum);
    __byId("attAdj").textContent = sum === null || years === 3 ? "—" : String(adj);
    __byId("attUsed").textContent = adj === null ? "—" : String(Math.min(adj, 100));
    __byId("attScore").textContent = att === null ? "—" : att.toFixed(1);

    const totalScore = seoulTotalScore(subject, att);
    __byId("totalScore").textContent = totalScore === null ? "—" : totalScore.toFixed(3);
    __byId("scoreBar").style.width = (totalScore === null ? 0 : Math.min(100, totalScore)) + "%";
  }

  [...SUBJECT_IDS, "sbj-low", ...[1, 2, 3].flatMap((y) => ATT_PARTS.map((p) => `att-${y}-${p}`))].forEach((id) => on(__byId(id), "input", calculate));
  on(__byId("att-years"), "change", calculate);
  calculate();

  // ---------- 검정고시 환산 ----------
  function calculateGed() {
    const tEl = __byId("gedTotal"), lEl = __byId("gedLow"), err = __byId("gedError");
    const ratioEl = __byId("gedRatio"), scoreEl = __byId("gedScore");
    const reset = () => { ratioEl.textContent = "—"; scoreEl.textContent = "—"; };
    const bad = isBad(tEl) || isBad(lEl);
    if (!bad && (!tEl.value.trim() || !lEl.value.trim())) { reset(); err.classList.remove("show"); return; }
    const t = isBad(tEl) ? NaN : Number(tEl.value), l = isBad(lEl) ? NaN : Number(lEl.value);
    const score = seoulGedScore(t, l);
    if (score === null) {
      err.textContent = !isCount(t) || t === 0 || !isCount(l) ? "총 응시 과목수는 1 이상, 60점 미만 과목수는 0 이상의 정수로 입력하세요." : "60점 미만 과목수는 총 응시 과목수보다 클 수 없습니다.";
      err.classList.add("show");
      reset();
      return;
    }
    err.classList.remove("show");
    ratioEl.textContent = (Math.round((l / t) * 100000) / 1000).toFixed(3);
    scoreEl.textContent = score.toFixed(3);
  }
  ["gedTotal", "gedLow"].forEach((id) => on(__byId(id), "input", calculateGed));

  // ---------- 서브탭 ----------
  function switchSubTab(btn, targetId) {
    btn.parentElement.querySelectorAll(".sub-nav-item").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    const section = btn.closest(".section");
    section.querySelectorAll(".subtab-content").forEach((c) => c.classList.remove("active"));
    const target = section.querySelector("#" + CSS.escape(targetId));
    if (target) target.classList.add("active");
  }

  // ---------- 제출 서류 체크리스트 (원문에 적힌 서류만) ----------
  const checklistData = {
    superintendent: {
      title: "교육감 선발 후기고 — 원서 제출처",
      page: "p.7~8",
      items: [
        { name: "서울특별시 내 중학교 졸업자 및 졸업예정자(대안교육 위탁교육기관 위탁생 포함)", desc: "출신 중학교에 원서 제출" },
        { name: "다른 시·도 중학교 졸업자로서 서울특별시에 거주하는 자", desc: "거주지 관할 교육지원청에 원서 제출" },
        { name: "중학교 졸업자와 동등의 학력이 있다고 인정된 자로서 서울특별시에 거주하는 자", desc: "거주지 관할 교육지원청에 원서 제출" },
        { name: "다른 시·도 특성화 중학교 및 전국단위 모집 자율학교로 지정된 중학교 졸업예정자 중 서울특별시에 거주하는 자", desc: "거주지 관할 교육지원청에 원서 제출" },
        { name: "고등학교 특례 입학대상자 중 국내 중학교에 편입한 사실이 없는 자로서 서울특별시에 거주하는 자", desc: "거주지 관할 교육지원청에 원서 제출" },
        { name: "예술·체육·과학중점학급 지원자", desc: "교육감 선발 후기고 원서에 지원사항 작성·제출 (예술·체육중점학급은 학교별 전형요강에 따른 서류를 해당 고등학교에 별도 제출)" },
      ],
      note: "학교별 및 지원 구분별 원서 수합: 거주지 관할 교육지원청",
    },
    vocational: {
      title: "특성화고등학교",
      page: "p.6, p.54",
      items: [
        { name: "입학원서 (공통)", desc: "서울 소재 중학교 졸업예정자 및 졸업자: 출신 중학교에서 작성 제출 · 다른 시·도 중학교 졸업예정자 및 졸업자, 검정고시 합격자 등: 해당 특성화고등학교에 직접 작성 제출" },
        { name: "검정고시 합격자 추가 서류", desc: "합격증명서와 성적증명서, 주민등록등본 (※ 미래인재 특별전형 지원자는 성적증명서 제출 제외)" },
        { name: "미래인재 특별전형", desc: "학교생활기록부Ⅱ(교과성적 및 수상경력 제외)" },
        { name: "학교장 특별전형", desc: "학교별 전형요강에 따름" },
      ],
    },
    pe: {
      title: "서울체육고등학교",
      page: "p.51",
      items: [
        { name: "입학 원서 1부", desc: "" },
        { name: "학교생활기록부 사본 1부", desc: "" },
        { name: "해당 경기단체 발행 경기입상실적증명서 1부(원본대조필)", desc: "※ 해당자에 한함" },
        { name: "자기소개서 및 진로계획서 1부", desc: "해당서식 반드시 제출 (미제출자는 합격 배제)" },
        { name: "검정고시 합격자는 합격증 사본 1부", desc: "" },
        { name: "국가유공자녀·특례입학지원자 확인서 1부", desc: "국가유공자녀는 교육보호대상자 확인서(국가보훈부 발행), 특례입학지원자는 고입면제대상자 확인서(교육청 발행)" },
        { name: "신체검사서 1부", desc: "공무원 채용 신체검사서" },
        { name: "개인정보 활용 동의서 1부", desc: "" },
      ],
    },
    science: {
      title: "과학계열 특목고 (세종과학고·한성과학고)",
      page: "p.4, p.40~42",
      items: [
        { name: "소속 학교장의 추천", desc: "소속 학교장의 추천을 받아 해당 고등학교에 개별 지원 (학교장추천서의 전형자료 활용은 학교에서 자율 결정)" },
        { name: "입학 원서", desc: "교육청 및 과학고등학교가 지정한 양식" },
        { name: "자기소개서", desc: "자기주도학습 영역(꿈과 끼 영역)과 인성영역을 통합하여 3,000자 범위 내 · 학생 본인이 직접 작성하여 제출(파일 제출 가능)" },
        { name: "교사 추천서", desc: "교과(과학, 수학) 담당 교사 중 1인이 작성, 1,000자 범위 내 · 추천교사가 입학전형 지원 관련 시스템에서 직접 입력 제출" },
        { name: "학생생활기록부", desc: "학생생활기록부Ⅱ(상급학교 제출용)" },
      ],
    },
    foreign: {
      title: "외국어고·국제고",
      page: "p.9, p.44~47",
      items: [
        { name: "입학원서", desc: "해당 고등학교에 직접 개별 제출 (교육감의 승인을 받은 학교별 전형요강에 따라 지원)" },
        { name: "자기소개서", desc: "자기주도학습 영역(꿈과 끼 영역)과 인성 영역 포함 1,500자(띄어쓰기 제외) 이내, 본인이 직접 작성" },
        { name: "학교생활기록부", desc: "수상경력 제외 · 교과학습발달상황은 영어, 국어, 사회(없을 경우 역사) 과목의 성취도(수강자수)만 출력 · 세부능력 및 특기사항 제외 · 중학교 3학년의 행동특성 및 종합의견 제외" },
        { name: "기타 제출서류", desc: "학교별 전형요강(해당 고등학교 홈페이지 참조)" },
      ],
    },
    autonomous: {
      title: "자율형 사립고",
      page: "p.9~10, p.57~60",
      items: [
        { name: "입학원서 등 제출서류", desc: "해당 고등학교에 직접 개별 지원" },
        { name: "사회통합전형 증빙서류", desc: "사회통합전형 지원자는 증빙서류도 함께 제출함" },
        { name: "자기소개서 (2단계 면접대상자만)", desc: "1,200자(띄어쓰기 제외, 하나고등학교는 1,500자) 이내, 본인이 직접 작성" },
        { name: "학교생활기록부 (2단계 면접대상자만)", desc: "서울 방식: 수상경력, 교과학습발달상황, 중학교 3학년의 행동특성 및 종합 의견 출력 시 제외 · 하나고: 수상경력 제외, 교과학습발달상황은 성취도(수강자수)만 출력, 중학교 3학년의 세부능력 및 특기 사항, 행동특성 및 종합의견 제외" },
      ],
    },
    focus: {
      title: "예술·체육중점학급 운영학교 (4교)",
      page: "p.8, p.62~63",
      items: [
        { name: "학교별 전형요강에 따른 제출서류", desc: "해당 고등학교에 직접 개별 지원" },
        { name: "교육감 선발 후기고 원서", desc: "학교별 지원서와 별도로 후기고등학교 원서를 작성·제출하여야 함(지원사항 작성)" },
        { name: "자기소개서", desc: "자기주도학습 영역(꿈과 끼 영역)과 인성 영역 포함 1,500자(띄어쓰기 제외) 이내, 학생 본인이 직접 작성하여 다른 서류와 함께 지원하는 학교에 제출" },
      ],
    },
  };

  function showChecklist(btn, key) {
    if (!btn) return;
    btn.parentElement.querySelectorAll(".checklist-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    const data = checklistData[key];
    if (!data) return;
    __byId("checklistResult").innerHTML = `
      <h4>${data.title}</h4>
      ${data.items.map((item) => `
        <div class="checklist-item">
          <div class="cb"></div>
          <div class="checklist-item-content">
            <div class="checklist-item-title">${item.name}</div>
            ${item.desc ? `<div class="checklist-item-desc">${item.desc}</div>` : ""}
          </div>
        </div>`).join("")}
      ${data.note ? `<div style="margin-top:12px;font-size:12px;color:var(--ink-soft);">${data.note}</div>` : ""}
      <div style="margin-top:14px;font-size:11.5px;color:var(--muted);font-style:italic;">※ 출처: 기본계획 ${data.page} · 원문에 없는 서류는 학교별 입학전형 요강을 따릅니다.</div>`;
  }
  showChecklist(__root.querySelector(".checklist-btn.active"), "superintendent");

  // ---------- FAQ ----------
  function toggleFAQ(item) {
    item.classList.toggle("open");
  }

  // ---------- 플로팅 메인 버튼 ----------
  const floatHome = __byId("floatHome");
  let floatHomeTimer = null;
  function updateFloatHome() {
    const homeSection = __byId("section-home");
    const onHome = homeSection && homeSection.classList.contains("active");
    floatHome.classList.toggle("show", !onHome && window.scrollY > 300);
  }
  on(window, "scroll", () => {
    if (floatHomeTimer) return;
    floatHomeTimer = setTimeout(() => { updateFloatHome(); floatHomeTimer = null; }, 100);
  }, { passive: true });
  updateFloatHome();

  // 인라인 처리기(onclick="showSection(…)" 등)가 부르는 이름 — 화면이 떠 있는 동안만 window 에
  const __expose = { closeSearch, doSearch, openSearch, showChecklist, showSection, switchSubTab, toggleFAQ, toggleSidebar };
  for (const k in __expose) __defGlobal(k, () => __expose[k]);

  return () => {
    __dead = true;
    offs.forEach((f) => f());
    timers.forEach((t) => clearTimeout(t));
    if (midnightTimer) clearTimeout(midnightTimer);
    if (floatHomeTimer) clearTimeout(floatHomeTimer);
    for (const [k, prev] of __globals) {
      delete window[k];
      if (prev) Object.defineProperty(window, k, prev);
    }
    document.title = __prevTitle;
  };
}
