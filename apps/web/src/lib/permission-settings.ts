import { prisma } from "@/lib/db";

// ─── 역할별 권한 설정(2026-10-14 QA76 #39 「역할별 권한 켜기·끄기 화면」) ─────────────────────────
// 본부(관리자)가 원장·직원의 권한 몇 가지를 켜고 끈다. 저장은 AppSetting 한 줄(JSON, 스키마 변경 없음).
// 모든 API 가 읽으므로 60초 메모리 캐시 + 저장 시 즉시 무효화(lib/leave-catalog-db 와 같은 방식).
//
// 켜고 끌 수 있는 것은 **게이트가 코드 한두 곳에 모여 있어 설정 하나로 전부 따라오는 권한**만이다.
// 그 밖의 권한(직원 추가·휴가 대리 등록·출퇴근 직접 수정 = 본부만, 직원의 동료 일정·휴가 열람 = 불가)은
// 본부 답변·#53·#80 으로 **고정**이며 FIXED_RULES 에 이유와 함께 적어 화면에 보여 준다.
export type PermissionKey = "manager.editSchedule" | "manager.viewAttendance" | "employee.viewOwnAttendance" | "employee.viewLeaveBalance" | "leave.blockGrantOverdraw";
export type PermissionRole = "MANAGER" | "EMPLOYEE";
// appliesTo — 한 토글이 여러 역할에 걸릴 때(예: 잔여 연차 숫자 = 직원·원장). 없으면 role 하나. 화면은 role 칸에 그린다
// brief = 화면에 늘 보이는 두 줄 설명(R15), hint = 자세한 설명, effects = 개발용 적용 범위 — 둘은 「적용 범위 보기 ›」를 눌렀을 때만
export type PermissionToggle = { key: PermissionKey; role: PermissionRole; appliesTo?: PermissionRole[]; label: string; brief: string; hint: string; def: boolean; shiftee: boolean; effects: string };

export const PERMISSION_TOGGLES: PermissionToggle[] = [
  {
    key: "manager.editSchedule", role: "MANAGER", label: "근무일정 직접 편집",
    brief: "담당 지점 직원 · 본인 근무일정을 결재 없이 바로 추가 · 수정 · 삭제합니다. 끄면 「근무일정 신청」으로만 바꿉니다.",
    hint: "원장이 담당 지점 직원·본인 근무일정을 결재 없이 바로 추가·수정·삭제·일괄 등록·엑셀 업로드합니다. 끄면 원장도 「근무일정 신청」으로만 바꿀 수 있습니다.",
    def: true, shiftee: true,
    effects: "팀 근무일정 화면의 추가·일괄 생성·칸 편집, API schedule POST/PATCH/DELETE/bulk/import(lib/schedule-guard)",
  },
  {
    key: "manager.viewAttendance", role: "MANAGER", label: "지점 출퇴근 기록 열람",
    brief: "담당 지점 직원의 출퇴근 기록 · 오늘 현황 · 근로시간 리포트를 봅니다. 끄면 본인 것만 봅니다.",
    hint: "원장이 담당 지점 직원의 출퇴근 기록(달력·목록)·오늘 현황·통계·근로시간 리포트를 봅니다. 끄면 원장은 본인 출퇴근만 봅니다. 수정 요청 결재는 그대로입니다.",
    def: true, shiftee: true,
    effects: "팀 출퇴근기록·근로시간 리포트 메뉴, API attendance/board·today-list·work-report(403), attendance·stats(본인만)",
  },
  {
    key: "employee.viewOwnAttendance", role: "EMPLOYEE", label: "본인 출퇴근 기록 열람(웹)",
    brief: "웹 「출퇴근 관리」에서 본인 오늘 상태와 기간별 통계를 봅니다. 끄면 앱의 오늘 상태 · 수정 요청만 씁니다.",
    hint: "직원이 웹 [출퇴근 관리]에서 본인 오늘 상태와 기간별 통계를 봅니다. 꺼져 있으면 웹 메뉴가 숨고 앱의 오늘 상태·수정 요청만 씁니다(2026-10-08 본부 답변 #3, 시프티와 같음).",
    def: false, shiftee: false,
    effects: "웹 출퇴근 관리 메뉴·화면(app/(dashboard)/attendance). 앱은 영향 없음",
  },
  {
    // 2026-10-16 #219-1(디렉터 결정 (a)) — 시프티 사용 내역 이관 전에는 잔여 숫자가 시프티와 달라 직원 문의·오신청이 생긴다
    key: "employee.viewLeaveBalance", role: "EMPLOYEE", appliesTo: ["EMPLOYEE", "MANAGER"], label: "잔여 연차 숫자 보기(직원·원장)",
    brief: "본인 잔여 연차를 숫자로 봅니다. 끄면 「연차 정리 중」만 보이고 신청은 그대로 됩니다.",
    hint: "직원·원장이 본인 잔여 연차(대시보드·휴가 신청 창·연차 대장·앱)와, 원장이 담당 지점 직원 잔여를 숫자로 봅니다. 꺼져 있으면 숫자 자리에 「연차 정리 중」만 보이고, 휴가 신청은 그대로 되며 잔여를 넘는 신청은 숫자 없이 막습니다. 시프티 휴가 사용 내역 이관을 마친 뒤 켜세요. 본부는 언제나 봅니다.",
    def: false, shiftee: true,
    effects: "웹 대시보드·휴가 신청 창·연차 대장, 앱 홈·휴가 화면, API me/dashboard-stats·leave/balance·leave/ledger·leave/days·employees(잔여 칸)",
  },
  {
    // 디렉터 결정(10/16): 보상휴가·대체휴일도 잔여를 넘으면 막되, **시프티 부여 내역을 옮긴 뒤부터**. 지금은 부여 기록이 0건이라
    // 켜면 모든 보상·대체 신청과 결재 대기 건이 막힌다. 연차 잔여 초과 막기는 이 스위치와 관계없이 늘 켜져 있다
    key: "leave.blockGrantOverdraw", role: "EMPLOYEE", appliesTo: ["EMPLOYEE", "MANAGER"], label: "보상휴가·대체휴일 잔여 초과 신청 막기",
    brief: "보상휴가 · 대체휴일을 잔여보다 많이 신청하지 못하게 막습니다. 연차 잔여 초과 막기는 늘 켜져 있습니다.",
    hint: "보상휴가·대체휴일을 잔여(부여 합 − 승인된 사용)보다 많이 신청하면 막고, 최종 승인 때도 다시 확인합니다. 시프티 보상·대체 부여 내역을 옮긴 뒤 켜세요(지금 켜면 부여 기록이 없는 직원은 신청할 수 없습니다). 연차 잔여 초과 막기는 늘 켜져 있습니다.",
    def: false, shiftee: true,
    effects: "휴가 신청(api/leave)·미리보기(api/leave/days)·최종 승인(api/leave/[id]/approve)의 보상·대체 잔여 판정(lib/leave-limit)",
  },
];

/** 바꿀 수 없는 규칙 — 화면에서 자물쇠와 이유를 보여 준다 */
export const FIXED_RULES: { label: string; state: string; why: string }[] = [
  { label: "원장 직원 추가(계정 만들기)", state: "본부만", why: "시프티 「직원 추가 OFF」·2026-10-07 본부 결정. 원장용 등록 화면이 없고, 계정 생성은 인사명부와 맞춰야 합니다." },
  { label: "원장 휴가 대리 등록", state: "본부만", why: "시프티 「휴가 직접 등록 OFF」·본부 답변 #28. 대리 등록은 결재 없이 바로 승인·차감되므로 본부만 합니다." },
  { label: "출퇴근 기록 직접 수정·추가", state: "본부만", why: "#53 「출퇴근 기록 수정 권한은 무조건 본부만」. 원장·직원은 수정 요청(결재)으로 합니다." },
  { label: "원장 근무일정 템플릿 관리", state: "본부만", why: "시프티는 원장 ON 이었으나 큐브티는 본부가 지점 전용 템플릿을 지정합니다. 원장용 관리 화면을 만들 때 설정으로 바꿀 수 있습니다." },
  { label: "직원 동료 근무일정·휴가 열람", state: "불가", why: "#80 「직원이 동료 일정·휴가를 보는 기능은 만들지 않음」. 원장만 담당 지점 직원의 휴가·일정을 봅니다." },
  { label: "원장 지점 직원 휴가·일정 열람", state: "담당 지점(고정 켬)", why: "결재·연차 대장·리포트가 이 범위에 기대고 있어 끌 수 없습니다." },
];

export const PERMISSIONS_KEY = "permissions";
export type PermissionSettings = Record<PermissionKey, boolean>;
const KEYS = new Set<string>(PERMISSION_TOGGLES.map((t) => t.key));
const TTL_MS = 60 * 1000;
let cache: { at: number; value: PermissionSettings } | null = null;
let inflight: Promise<PermissionSettings> | null = null;
let generation = 0;   // 저장할 때마다 올린다 — 저장 전에 시작한 적재가 늦게 끝나 옛값을 캐시에 쓰지 못하게

export function defaultPermissions(): PermissionSettings {
  return Object.fromEntries(PERMISSION_TOGGLES.map((t) => [t.key, t.def])) as PermissionSettings;
}

/** 저장값(JSON) → 설정. 모르는 키는 버리고 빠진 키는 기본값(깨진 값이면 통째로 기본값 — 조용히 풀리는 쪽이 더 나쁘다) */
export function parsePermissions(raw: unknown): PermissionSettings {
  const out = defaultPermissions();
  let v = raw;
  if (typeof v === "string") { try { v = JSON.parse(v); } catch { return out; } }
  if (!v || typeof v !== "object" || Array.isArray(v)) return out;
  for (const [k, b] of Object.entries(v as Record<string, unknown>)) if (KEYS.has(k) && typeof b === "boolean") out[k as PermissionKey] = b;
  return out;
}

/** 현재 설정(60초 캐시). 읽기 실패면 기본값(= 시프티·종전 규칙) — 설정 저장소 장애가 권한을 넓히지 않게 */
export async function readPermissions(): Promise<PermissionSettings> {
  const now = Date.now();
  if (cache && now - cache.at < TTL_MS) return cache.value;
  if (inflight) return inflight;
  const gen = generation;
  inflight = (async () => {
    try {
      const row = await prisma.appSetting.findUnique({ where: { key: PERMISSIONS_KEY } });
      const value = parsePermissions(row?.value);
      if (gen === generation) cache = { at: Date.now(), value };   // 그 사이 저장됐으면 이 결과는 캐시에 남기지 않는다
      return value;
    } catch (e) {
      console.error("[permissions] 설정 읽기 실패(기본값 사용):", e instanceof Error ? e.message : e);
      const value = cache?.value ?? defaultPermissions();
      if (gen === generation) cache = { at: Date.now() - TTL_MS + 10_000, value };   // 10초 뒤 다시
      return value;
    } finally { inflight = null; }
  })();
  return inflight;
}

export async function isAllowed(key: PermissionKey): Promise<boolean> {
  return (await readPermissions())[key];
}

/** 내 역할에 해당하는 토글만 — 화면(사이드바·메뉴)이 쓴다. 관리자는 전부 true */
export async function permissionsForRole(role: string): Promise<Partial<PermissionSettings>> {
  const all = await readPermissions();
  const out: Partial<PermissionSettings> = {};
  for (const t of PERMISSION_TOGGLES) out[t.key] = role === "ADMIN" ? true : (t.appliesTo ?? [t.role]).includes(role as PermissionRole) ? all[t.key] : false;
  return out;
}

/** 잔여 연차 숫자를 이 역할에게 보여도 되나(#219-1) — 본부(ADMIN)는 언제나, 직원·원장은 「잔여 연차 숫자 보기」가 켜졌을 때만 */
export async function canSeeLeaveBalance(role: string): Promise<boolean> {
  if (role === "ADMIN") return true;
  return isAllowed("employee.viewLeaveBalance");
}

export async function savePermissions(next: PermissionSettings): Promise<void> {
  const value = JSON.stringify(next);
  await prisma.appSetting.upsert({ where: { key: PERMISSIONS_KEY }, create: { key: PERMISSIONS_KEY, value }, update: { value } });
  invalidatePermissions();   // 즉시 반영 — 같은 프로세스. (운영은 컨테이너 1개라 충분하다; 여러 개면 60초 안에 따라온다)
}

export function invalidatePermissions(): void { generation += 1; cache = null; }
