// DB enum 값 검증 — 한 곳에서 (2026-09-06)
//
// 왜 필요한가: 쿼리스트링·요청 본문의 문자열을 그대로 Prisma 에 넘기면 **잘못된 값 하나에
// 500** 이 난다. 주소창 오타 한 번이 서버 오류가 되고, 로그에도 "터진 오류"로 쌓인다.
// 실측(2026-09-06): `?status=BOGUS` → 500 이 계약·휴가·근무일정·템플릿 네 곳,
// `PATCH {role:"SUPERUSER"}` 도 500.
//
// 종전에는 `as never` 로 타입검사를 꺼서 넘겼다. `as never` 는 **검사를 끄는 것이지 값을
// 만들어주지 않는다** — `prisma: any` 가 없는 컬럼 오타를 숨겼던 것과 같은 부류다
// (2026-09-04 서명 시 문서 재생성이 100% 죽어 있던 결함).
//
// ⚠ 값은 schema.prisma 와 손으로 맞춘 목록이다. enum 에 값을 더하면 여기도 더한다.
//   (Prisma 가 내보내는 런타임 객체는 서버에서만 쓸 수 있어, 클라이언트와 공유하려면 이 형태가 낫다)

export const ROLES = ["ADMIN", "MANAGER", "EMPLOYEE"] as const;
export const CONTRACT_TYPES = ["EMPLOYMENT", "PART_TIME", "CONFIDENTIAL", "OTHER"] as const;
export const CONTRACT_STATUSES = ["DRAFT", "SENT", "APPROVED", "SIGNED", "EXPIRED", "REJECTED"] as const;
export const LEAVE_STATUSES = ["PENDING", "APPROVED", "REJECTED", "CANCELLED"] as const;
export const SCHEDULE_REQUEST_STATUSES = ["PENDING", "APPROVED", "REJECTED", "CANCELLED"] as const;
export const EMPLOYMENT_STATUSES = ["ACTIVE", "RESIGNED", "ON_LEAVE", "TEMPORARY"] as const;
export const ATTENDANCE_STATUSES = ["NORMAL", "LATE", "EARLY_LEAVE", "ABSENT", "HOLIDAY"] as const;

/** 목록에 있는 값이면 그대로, 아니면 undefined. **필터(where)** 에 쓴다 — 모르는 값은 "안 건 것"으로. */
export function pick<T extends readonly string[]>(list: T, v: unknown): T[number] | undefined {
  return typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T[number]) : undefined;
}

/** 목록에 있는 값이면 그대로, 아니면 기본값. **쓰기(data)** 에 쓴다 — 값이 반드시 있어야 하는 자리. */
export function pickOr<T extends readonly string[]>(list: T, v: unknown, fallback: T[number]): T[number] {
  return pick(list, v) ?? fallback;
}
