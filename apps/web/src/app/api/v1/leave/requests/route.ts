import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { authenticateApiKey, v1Error } from "@/lib/api-key";
import { prisma } from "@/lib/db";
import { ensureLeaveCatalog } from "@/lib/leave-catalog-db";
import { leaveInfo } from "@/lib/leave-catalog";

export const dynamic = "force-dynamic";

// 휴가 신청 읽기 — 회사 연동 키(ORG, scope leave:read) 전용 (2026-11-09 이예지 요청, 디렉터 「처리해 주자」)
// 직영 포털이 매일 오전 11시에 그사이 들어온 원장 휴가 신청을 모아 팀즈 「직영_인사업무」 방에 보고한다.
//   GET /api/v1/leave/requests?since=<ISO>&jobGroup=원장&limit=200
//     since        — 이 시각 이후에 **신청된** 건(신청 시각 기준). 없으면 24시간 전부터
//     updatedSince — 대신 이 시각 이후에 **상태가 바뀐** 건(승인 · 반려 · 취소 확인용). since 와 함께 주면 updatedSince 가 이긴다
//     jobGroup     — 직무(원장 · CM · 코디 …). 없으면 전체
//     limit        — 기본 200, 최대 500. 더 있으면 nextSince(또는 nextUpdatedSince)로 이어 받는다
//   → { requests: [...], nextSince | nextUpdatedSince | null }
//   대체휴일은 「어느 근무일 대신인지」가 신청에 따로 저장되지 않는다 — 그 사람의 대체휴일 부여(근무일)를 먼저 부여된 순서로
//   앞선 신청부터 채워 맞춘 **추정**이다(substitute.basis = "부여 순서 추정"). 포상휴가는 10년 근속 5일 기준 남은 일수.
// 시프티에서 옮겨 온 기록(importBatch)은 뺀다.
const MAX_LIMIT = 500;
const REWARD_GRANTED = 5;
const STATUS_LABEL: Record<string, string> = { PENDING: "대기", APPROVED: "승인", REJECTED: "반려", CANCELLED: "취소" };
const LIVE: ("PENDING" | "APPROVED")[] = ["PENDING", "APPROVED"];

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const kstHhmm = (d: Date | null) => (d ? new Date(d.getTime() + 9 * 3600_000).toISOString().slice(11, 16) : null);
function parseTime(v: string | null): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

type Row = Prisma.LeaveRequestGetPayload<{ include: { user: { select: { empNo: true; name: true; branch: true; jobGroup: true } } } }>;

/** 대체휴일 — 그 사람의 부여 근무일을 오래된 것부터, 이 신청보다 앞선(대기 · 승인) 대체휴일 신청이 먼저 쓴 만큼 채우고 남은 첫 근무일 */
async function substituteOf(r: Row) {
  const codes = (await prisma.leaveRequest.findMany({ where: { userId: r.userId }, select: { type: true }, distinct: ["type"] }))
    .map((x) => x.type).filter((t) => leaveInfo(t)?.group === "대체휴일");
  const [grants, prior] = await Promise.all([
    prisma.leaveGrant.findMany({ where: { userId: r.userId, group: "대체휴일", days: { gt: 0 }, workDate: { not: null } }, orderBy: { workDate: "asc" }, select: { workDate: true, days: true } }),
    prisma.leaveRequest.findMany({
      where: { userId: r.userId, type: { in: codes }, status: { in: LIVE }, importBatch: null, OR: [{ createdAt: { lt: r.createdAt } }, { createdAt: r.createdAt, id: { lt: r.id } }] },
      select: { days: true },
    }),
  ]);
  let used = prior.reduce((n, p) => n + p.days, 0);
  for (const g of grants) {
    if (used >= g.days - 1e-9) { used -= g.days; continue; }
    const wd = g.workDate!;
    const att = await prisma.attendance.findFirst({ where: { userId: r.userId, date: wd }, select: { clockIn: true, clockOut: true } });
    return { workDate: ymd(wd), checkIn: kstHhmm(att?.clockIn ?? null), checkOut: kstHhmm(att?.clockOut ?? null), basis: "부여 순서 추정" };
  }
  return null;   // 맞출 부여 근무일이 없다(수동 부여만 있거나 부여보다 많이 신청)
}

/** 포상휴가 — 10년 근속 5일. used 는 이 신청까지(대기 · 승인)의 포상휴가 합 */
async function rewardBalanceOf(r: Row) {
  const rows = await prisma.leaveRequest.findMany({
    where: { userId: r.userId, type: "REWARD", status: { in: LIVE }, importBatch: null, OR: [{ createdAt: { lt: r.createdAt } }, { id: r.id }] },
    select: { days: true },
  });
  const used = rows.reduce((n, x) => n + x.days, 0);
  return { granted: REWARD_GRANTED, used, remaining: Math.max(0, REWARD_GRANTED - used) };
}

export async function GET(request: NextRequest) {
  const a = await authenticateApiKey(request, "leave:read", "read");
  if (a.ok === false) return a.res;
  if (a.p.key.kind !== "ORG") return v1Error(403, "회사 연동 키로만 쓸 수 있습니다.", "ORG_KEY_ONLY");

  const sp = new URL(request.url).searchParams;
  const sinceRaw = sp.get("since");
  const updRaw = sp.get("updatedSince");
  const since = parseTime(sinceRaw);
  const updatedSince = parseTime(updRaw);
  if (sinceRaw && !since) return v1Error(400, "since 는 ISO 시각이어야 합니다(예: 2026-11-09T02:00:00Z).", "BAD_SINCE");
  if (updRaw && !updatedSince) return v1Error(400, "updatedSince 는 ISO 시각이어야 합니다.", "BAD_SINCE");
  const jobGroup = (sp.get("jobGroup") || "").trim();
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(sp.get("limit")) || 200));
  const byUpdate = !!updatedSince;
  const from = updatedSince ?? since ?? new Date(Date.now() - 24 * 3600_000);

  const where: Prisma.LeaveRequestWhereInput = {
    importBatch: null,
    ...(byUpdate ? { updatedAt: { gt: from } } : { createdAt: { gt: from } }),
    ...(jobGroup ? { user: { jobGroup } } : {}),
  };
  const rows = await prisma.leaveRequest.findMany({
    where,
    include: { user: { select: { empNo: true, name: true, branch: true, jobGroup: true } } },
    orderBy: byUpdate ? [{ updatedAt: "asc" }, { id: "asc" }] : [{ createdAt: "asc" }, { id: "asc" }],
    take: limit + 1,
  });
  const more = rows.length > limit;
  const page = rows.slice(0, limit);
  await ensureLeaveCatalog().catch(() => {});   // 본부가 만든 유형 이름까지

  const requests = [];
  for (const r of page) {
    const info = leaveInfo(r.type);
    requests.push({
      id: r.id,
      empNo: r.user.empNo != null ? String(r.user.empNo).padStart(5, "0") : null,
      name: r.user.name,
      branch: r.user.branch,
      jobGroup: r.user.jobGroup,
      type: info?.label ?? r.type,   // 화면에 보이는 이름 — 「오전 반차」 · 「오후 반차」로 오전 · 오후가 갈린다
      typeCode: r.type,
      startDate: ymd(r.startDate),
      endDate: ymd(r.endDate),
      days: r.days,
      reason: r.reason,
      status: STATUS_LABEL[r.status] ?? r.status,
      requestedAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      substitute: info?.group === "대체휴일" ? await substituteOf(r) : undefined,
      balance: r.type === "REWARD" ? await rewardBalanceOf(r) : undefined,
    });
  }
  const last = page[page.length - 1];
  return NextResponse.json(
    {
      requests,
      ...(byUpdate ? { nextUpdatedSince: more && last ? last.updatedAt.toISOString() : null } : { nextSince: more && last ? last.createdAt.toISOString() : null }),
    },
    { headers: { "Cache-Control": "no-store, private" } },
  );
}
