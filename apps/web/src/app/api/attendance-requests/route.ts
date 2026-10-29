import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { verifyAttendanceDevice } from "@/lib/device";
import { kstTodayYmd } from "@/lib/holidays";
import { getManagerBranches } from "@/lib/manager-branches";
import {
  KIND_LABEL, OUTSIDE_REASONS, STEP1_AUDIT, TWO_STEP_KINDS, attendanceStepsOf, dateOfYmd, displayReason, kstDateTime, kstYmdOf, resolveApprover, inboxWhere, summaryOf,
  statusSummaryOf, weekendClockInBlock, type RequestKind,
} from "@/lib/attendance-request";
import { canSeeClockTimes } from "@/lib/attendance-visibility";
import { haversineDistance } from "@/lib/geofence";
import { parseAccuracy, type GeoBranch } from "@/lib/geofence-log";
import { testRequesterExclusion } from "@/lib/employee-scope";


// 큐브티로 출퇴근을 찍기 시작한 날(2026-10-26 지점 전환) — 그 전 기록은 시프티 원본
const CUBETEE_ATTENDANCE_START = "2026-10-26";

export const dynamic = "force-dynamic";

// 출퇴근 요청 — 만들기(POST)·목록(GET). 처리는 [id]/route.ts, 사진은 [id]/photo. 규칙은 lib/attendance-request.ts.
// 기기 변경(DEVICE)은 여기서 만들지 않는다 — 로그인 화면(비밀번호 확인)에서만 접수한다(api/auth/login).

const PHOTO_EXT = new Set([".jpg", ".jpeg", ".png", ".heic", ".webp"]);
const PHOTO_DIR = path.join(process.cwd(), "uploads", "private", "attendance-photos");
const YMD = /^\d{4}-\d{2}-\d{2}$/;

const str = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const num = (v: unknown) => {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};

type RowIn = {
  id: string; userId: string; kind: string; action: string | null; workDate: Date; requestedAt: Date; clockIn: Date | null;
  clockOut: Date | null; reason: string | null; memo: string | null; photoPath: string | null; deviceName: string | null;
  platform: string | null; approverRole: string; branch: string | null; status: string; decidedAt: Date | null;
  rejectReason: string | null; createdAt: Date; latitude: number | null; longitude: number | null; accuracy?: number | null;
  user: { name: string; branch: string | null; position: string | null; role?: string };
};
type Extra = {
  showTimes: boolean;
  /** 1차(원장) 승인 — 출퇴근 수정 두 단계(■0-11) */
  step1: Map<string, { name: string; at: Date }>;
  /** 그날 기록 상태 「출근 · 퇴근 누락」 — 원장 카드에 시각 대신 */
  recordState: Map<string, string>;
  /** 지점 좌표(이름 → 좌표 · 인정 거리) — 지점 밖 · 사진 · 본부 요청 카드의 「지점까지 약 ○m · 오차 ○m」(2026-10-27 이예지) */
  geo: Map<string, GeoBranch>;
  /** 원장 요청자의 담당 지점(대표 + 겸직) — 거리는 그중 가장 가까운 지점 기준(clock-in 판정과 같은 규칙, 10/27 검증) */
  managerBranches: Map<string, string[]>;
  /** 퇴근 처리 요청 · 기록 수정의 퇴근 시각이 기준보다 늦은 만큼(본부 단계에만 — 2026-10-29 이예지 「일정 퇴근 + ○분 늦음」) */
  outLate: Map<string, string>;
};

/** 요청 때 찍힌 위치와 소속 지점 사이 거리(m) — 좌표 숫자는 내려보내지 않는다 */
function geoOf(r: RowIn, geo: Map<string, GeoBranch>, managerBranches: Map<string, string[]>) {
  const accuracyM = r.accuracy == null ? null : Math.round(r.accuracy);
  const names = managerBranches.get(r.userId) ?? (r.user.branch ? [r.user.branch] : []);
  if (r.latitude == null || r.longitude == null || !names.length) return { distanceM: null as number | null, radiusM: null as number | null, nearBranch: null as string | null, accuracyM };
  let best: { distanceM: number; radiusM: number; nearBranch: string } | null = null;
  for (const n of names) {
    const b = geo.get(n);
    if (!b || b.latitude == null || b.longitude == null) continue;
    const d = Math.round(haversineDistance(r.latitude, r.longitude, b.latitude, b.longitude));
    if (!best || d < best.distanceM) best = { distanceM: d, radiusM: b.radius, nearBranch: n };
  }
  return best ? { ...best, accuracyM } : { distanceM: null, radiusM: null, nearBranch: null, accuracyM };
}

/** 시각을 감추는 사람(직원 · 원장)에게는 시각 칸을 비우고 시각 없는 요약을 준다(■0-11). 본부는 그대로 */
function shapeRow(r: RowIn, deciderNames: Map<string, string>, decidedBy: string | null, x: Extra) {
  const step1 = x.step1.get(r.id) ?? null;
  // 두 단계 판정은 공용 함수(10/23 검증 E — 끝난 옛 1단계 건 · 본부가 바로 최종 승인한 건이 「결재 1/2」로 보였다)
  const twoStep = attendanceStepsOf(r, !!step1) === 2;
  const masked = !x.showTimes;
  return {
    ...shapeBase(r, deciderNames, decidedBy),
    // 올린 때(createdAt)도 시각이다 — 지점 밖 · 사진 · 본부 요청은 누른 때 = 출근 · 퇴근 시각(10/23 검증 C). 숨길 때는 날짜(createdDate)만
    ...(masked ? { requestedAt: null, clockIn: null, clockOut: null, createdAt: null, summary: statusSummaryOf(r) } : {}),
    ...(r.kind === "RECORD" ? { memo: null } : {}),   // 기록 요청의 memo 는 기간("from~to") — 요약(summary)에 사람이 읽는 말로 들어 있다
    timesHidden: masked,
    statusSummary: statusSummaryOf(r),   // 시각 없는 요약 — 본부 · 시각 보기 켠 원장도 대시보드 결재함 둘째 줄은 이것으로(「10월 23일 (금) 퇴근 누락 → 퇴근」)
    wantIn: !!r.clockIn,    // 출퇴근 수정이 고치려는 칸(시각 없이도 무엇을 고치는지)
    wantOut: !!r.clockOut,
    recordState: x.recordState.get(`${r.userId}|${r.workDate.toISOString().slice(0, 10)}`) ?? null,
    // 결재 흐름 — 출퇴근 수정은 「지점 원장 → 본부」. 1차 승인한 원장 이름 · 시각(본부 단계에서 보인다)
    steps: twoStep ? 2 : 1,
    // 지금 차례 · 다음 차례(앱 카드 「승인하면 본부로」) — 대기 중일 때만
    currentStep: r.status === "PENDING" ? (r.approverRole === "ADMIN" ? "HQ" : "MANAGER") : null,
    nextStep: r.status === "PENDING" && twoStep && r.approverRole === "MANAGER" ? "HQ" : null,
    step1: step1 ? { name: step1.name, at: step1.at } : null,
    approverLabel: r.approverRole === "ADMIN" ? (step1 ? "본부 (원장 승인 완료)" : "본부") : twoStep ? `${r.branch ?? ""} 원장 → 본부` : `${r.branch ?? ""} 원장`,
    // 지점 밖 · 사진 · 본부 요청 — 판정 근거(거리 · 오차 · 인정 거리). 진짜 지점 밖인지 판정 오류인지 보고 승인할 수 있게(2026-10-27 이예지)
    ...(r.kind === "OUTSIDE" || r.kind === "PHOTO" || r.kind === "HQ" ? geoOf(r, x.geo, x.managerBranches) : {}),
    // 늦음 표시 — 시각을 보는 사람(본부)에게만. 원장 1차 카드는 상태만(10/23 · 10/29 이예지)
    outLate: masked || r.approverRole !== "ADMIN" ? null : x.outLate.get(r.id) ?? null,   // 본부 단계 카드에만(원장 1차 카드는 시각 보기를 켜도 상태만 — 검증 P1)
  };
}

function shapeBase(r: RowIn, deciderNames: Map<string, string>, decidedBy: string | null) {
  return {
    id: r.id,
    userId: r.userId,
    userName: r.user.name,
    userBranch: r.user.branch,
    userPosition: r.user.position,
    kind: r.kind,
    kindLabel: KIND_LABEL[r.kind as RequestKind] ?? r.kind,
    action: r.action,
    workDate: r.workDate.toISOString().slice(0, 10),
    requestedAt: r.requestedAt,
    clockIn: r.clockIn,
    clockOut: r.clockOut,
    reason: displayReason(r.reason),   // 「기타: 」 떼고 적은 문장만(2026-10-28 이예지 ④)
    memo: r.memo,
    hasPhoto: !!r.photoPath,
    hasLocation: r.latitude != null && r.longitude != null,
    deviceName: r.deviceName,
    platform: r.platform,
    approverRole: r.approverRole,
    approverLabel: r.approverRole === "ADMIN" ? "본부" : `${r.branch ?? ""} 원장`,
    status: r.status,
    decidedByName: decidedBy ? deciderNames.get(decidedBy) ?? null : null,
    decidedAt: r.decidedAt,
    rejectReason: r.rejectReason,
    createdAt: r.createdAt as Date | null,
    createdDate: kstYmdOf(r.createdAt),   // 올린 날(KST "YYYY-MM-DD") — 시각을 숨겨도 늘 준다
    summary: summaryOf(r),
  };
}

const ROW_SELECT = {
  id: true, userId: true, kind: true, action: true, workDate: true, requestedAt: true, clockIn: true, clockOut: true,
  reason: true, memo: true, photoPath: true, deviceName: true, platform: true, approverRole: true, branch: true,
  status: true, decidedBy: true, decidedAt: true, rejectReason: true, createdAt: true, latitude: true, longitude: true, accuracy: true,
  user: { select: { name: true, branch: true, position: true, role: true } },
} as const;

// GET ?scope=mine(기본) | inbox(내가 처리할 대기) | history(관리자 전체·원장 담당 지점, 최근 60일)
//  · inbox · history 는 테스트 계정이 올린 요청을 기본으로 뺀다 — 관리자가 &includeTest=1 을 주면 넣는다(2026-10-23 이예지 답)
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  const sp = new URL(request.url).searchParams;
  const scope = sp.get("scope") || "mine";
  const since = new Date(Date.now() - 60 * 86400_000);

  let where: Record<string, unknown> | null;
  if (scope === "inbox") {
    where = await inboxWhere(session);
  } else if (scope === "history") {
    if (session.role === "ADMIN") where = { createdAt: { gte: since } };
    else if (session.role === "MANAGER") where = { createdAt: { gte: since }, user: { branch: { in: await getManagerBranches(session.userId) } } };
    else return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
  } else {
    where = { userId: session.userId, createdAt: { gte: since } };
  }
  if (!where) return NextResponse.json({ requests: [] });
  if (scope === "inbox" || scope === "history") {
    const testEx = await testRequesterExclusion(session, sp.get("includeTest"));
    if (testEx) where = { AND: [where, { user: testEx }] };
  }

  const rows = await prisma.attendanceRequest.findMany({
    where,
    select: ROW_SELECT,
    orderBy: { createdAt: scope === "inbox" ? "asc" : "desc" },
    take: 300,
  });
  const ids = [...new Set(rows.map((r) => r.decidedBy).filter(Boolean) as string[])];
  const names = new Map(
    (ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [])
      .map((u) => [u.id, u.name] as [string, string]),
  );
  const showTimes = await canSeeClockTimes(session.role);
  // 1차(원장) 승인 기록 — 출퇴근 수정 두 단계(■0-11). 스키마를 바꾸지 않고 AuditLog 에서 읽는다
  const twoStepIds = rows.filter((r) => TWO_STEP_KINDS.includes(r.kind)).map((r) => r.id);
  const step1 = new Map<string, { name: string; at: Date }>();
  if (twoStepIds.length) {
    const logs = await prisma.auditLog.findMany({ where: { action: STEP1_AUDIT, targetId: { in: twoStepIds } }, select: { targetId: true, actorName: true, createdAt: true }, orderBy: { createdAt: "asc" } });
    for (const l of logs) if (l.targetId && !step1.has(l.targetId)) step1.set(l.targetId, { name: l.actorName, at: l.createdAt });
  }
  // 그날 기록 상태(시각 없이) — 출퇴근 수정 카드에 「기록 · 출근 · 퇴근 누락」
  const recordState = new Map<string, string>();
  const fixRows = rows.filter((r) => TWO_STEP_KINDS.includes(r.kind));
  let fixAtt = new Map<string, { clockIn: Date | null }>();
  if (fixRows.length) {
    const atts = await prisma.attendance.findMany({
      where: { OR: fixRows.map((r) => ({ userId: r.userId, date: r.workDate })) },
      select: { userId: true, date: true, clockIn: true, clockOut: true, status: true },
    });
    const got = new Map(atts.map((a) => [`${a.userId}|${a.date.toISOString().slice(0, 10)}`, a]));
    fixAtt = got;
    for (const r of fixRows) {
      const k = `${r.userId}|${r.workDate.toISOString().slice(0, 10)}`;
      const a = got.get(k);
      recordState.set(k, !a || (!a.clockIn && !a.clockOut) ? "기록 없음"
        : [a.clockIn ? (a.status === "LATE" ? "지각" : "출근") : "출근 누락", a.clockOut ? "퇴근" : "퇴근 누락"].join(" · "));
    }
  }
  // 늦음 표시(2026-10-29 이예지 — 요청은 막지 않고 본부 결재 카드에 표시): 근무일정 퇴근 시각보다 늦으면 「근무일정 퇴근 HH:mm + ○분 늦음」,
  // 일정이 없는 날은 출근 + 10시간 30분보다 늦으면 같은 식으로. 시각을 보는 사람에게만 계산한다
  const outLate = new Map<string, string>();
  const lateRows = showTimes ? fixRows.filter((r) => r.clockOut) : [];
  if (lateRows.length) {
    const scheds = await prisma.schedule.findMany({ where: { OR: lateRows.map((r) => ({ userId: r.userId, date: r.workDate })), type: "WORK" }, select: { userId: true, date: true, startTime: true, endTime: true } });
    const sk = new Map(scheds.map((x) => [`${x.userId}|${x.date.toISOString().slice(0, 10)}`, x]));
    const ak = fixAtt;   // 그날 기록 — 위 「기록 상태」에서 이미 읽었다(같은 조건 두 번 읽지 않게, 검증 4)
    const hm = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}시간${m % 60 ? ` ${m % 60}분` : ""}` : `${m}분`);
    for (const r of lateRows) {
      const ymd = r.workDate.toISOString().slice(0, 10);
      const k = `${r.userId}|${ymd}`;
      const sc = sk.get(k);
      const out = r.clockOut!.getTime();
      if (sc?.endTime && kstDateTime(ymd, sc.endTime)) {
        let end = kstDateTime(ymd, sc.endTime);
        const start = sc.startTime ? kstDateTime(ymd, sc.startTime) : null;
        if (end && start && end.getTime() <= start.getTime()) end = new Date(end.getTime() + 86400_000);   // 자정 넘는 일정
        const late = end ? Math.round((out - end.getTime()) / 60000) : 0;
        if (late > 0) outLate.set(r.id, `근무일정 퇴근 ${sc.endTime} + ${hm(late)} 늦음`);
      } else {
        const cin = r.clockIn ?? ak.get(k)?.clockIn ?? null;
        const late = cin ? Math.round((out - (cin.getTime() + 630 * 60000)) / 60000) : 0;
        if (late > 0) outLate.set(r.id, `근무일정 없음 · 출근 + 10시간 30분보다 ${hm(late)} 늦음`);
      }
    }
  }
  // 지점 좌표 — 지점 밖 · 사진 · 본부 요청 카드의 거리 계산용(한 번만)
  const geo = new Map<string, GeoBranch>(
    rows.some((r) => r.kind === "OUTSIDE" || r.kind === "PHOTO" || r.kind === "HQ")
      ? (await prisma.branch.findMany({ select: { name: true, latitude: true, longitude: true, radius: true } })).map((b) => [b.name, b] as [string, GeoBranch])
      : [],
  );
  const managerBranches = new Map<string, string[]>();
  for (const uid of new Set(rows.filter((r) => r.user.role === "MANAGER" && (r.kind === "OUTSIDE" || r.kind === "PHOTO" || r.kind === "HQ")).map((r) => r.userId)))
    managerBranches.set(uid, await getManagerBranches(uid));
  return NextResponse.json({ requests: rows.map((r) => shapeRow(r, names, r.decidedBy, { showTimes, step1, recordState, geo, managerBranches, outLate })), timesHidden: !showTimes });
}

// POST — JSON(OUTSIDE·HQ·CORRECTION·MISSED_OUT·RECORD) 또는 multipart(PHOTO: file + 칸들)
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const isForm = (request.headers.get("content-type") || "").includes("multipart/form-data");
  let body: Record<string, unknown> = {};
  let file: File | null = null;
  try {
    if (isForm) {
      const fd = await request.formData();
      for (const [k, v] of fd.entries()) {
        if (k === "file") file = v instanceof File ? v : null;
        else body[k] = v;
      }
    } else {
      body = (await request.json()) as Record<string, unknown>;
    }
  } catch {
    return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }
  if (!body || typeof body !== "object") return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });

  const kind = body.kind as RequestKind;
  if (!["OUTSIDE", "PHOTO", "HQ", "CORRECTION", "MISSED_OUT", "RECORD"].includes(kind))
    return NextResponse.json({ error: "요청 종류가 올바르지 않습니다." }, { status: 400 });

  const me = await prisma.user.findUnique({ where: { id: session.userId }, select: { name: true, role: true, branch: true } });
  if (!me) return NextResponse.json({ error: "사용자를 찾을 수 없습니다." }, { status: 404 });
  if (me.role === "ADMIN") return NextResponse.json({ error: "관리자는 출퇴근 기록을 직접 수정할 수 있어 요청이 필요 없습니다." }, { status: 400 });

  const memo = str(body.memo, 200);
  const latitude = num(body.latitude);
  const longitude = num(body.longitude);
  const accuracy = parseAccuracy(body.accuracy);   // 폰 위치 오차(m, 2026-10-27) — 옛 앱은 null
  const now = new Date();
  const todayYmd = kstTodayYmd();

  const data: {
    kind: RequestKind; action: string | null; workDate: Date; requestedAt: Date; clockIn: Date | null; clockOut: Date | null;
    reason: string | null; memo: string | null; latitude: number | null; longitude: number | null; accuracy: number | null; photoPath: string | null;
  } = { kind, action: null, workDate: dateOfYmd(todayYmd), requestedAt: now, clockIn: null, clockOut: null, reason: null, memo, latitude, longitude, accuracy, photoPath: null };

  if (kind === "RECORD") {
    // 출퇴근 기록 요청(■0-11) — 찍은 시각은 본부만 보므로, 기록이 필요한 사람은 본부에 요청하고 본부가 내준다.
    // body: { kind: "RECORD", from: "YYYY-MM-DD", to: "YYYY-MM-DD", reason?: 쓰는 곳 }. 기간은 memo 에 "from~to"
    const from = typeof body.from === "string" && YMD.test(body.from) ? body.from : null;
    const to = typeof body.to === "string" && YMD.test(body.to) ? body.to : null;
    if (!from || !to || Number.isNaN(dateOfYmd(from).getTime()) || Number.isNaN(dateOfYmd(to).getTime()) || from > to)
      return NextResponse.json({ error: "기간을 확인해 주세요." }, { status: 400 });
    if (to > todayYmd) return NextResponse.json({ error: "오늘까지의 기록만 요청할 수 있습니다." }, { status: 400 });
    if (dateOfYmd(to).getTime() - dateOfYmd(from).getTime() > 366 * 86400_000) return NextResponse.json({ error: "한 번에 1년까지 요청할 수 있습니다." }, { status: 400 });
    const dup = await prisma.attendanceRequest.findFirst({ where: { userId: session.userId, kind: "RECORD", status: "PENDING" }, select: { id: true } });
    if (dup) return NextResponse.json({ error: "출퇴근 기록 요청이 이미 본부에 가 있습니다." }, { status: 409 });
    data.workDate = dateOfYmd(from);
    data.memo = `${from}~${to}`;
    data.reason = str(body.reason, 100);
  } else if (kind === "OUTSIDE" || kind === "PHOTO" || kind === "HQ") {
    // 출퇴근 대신이므로 출근 버튼과 같은 기기 검증(대리 출퇴근 방지)
    const deviceError = await verifyAttendanceDevice(session.userId, session.role, request.headers.get("x-device-id"));
    if (deviceError) return NextResponse.json({ error: deviceError }, { status: 403 });

    const action = body.action === "IN" || body.action === "OUT" ? body.action : null;
    if (!action) return NextResponse.json({ error: "출근·퇴근 중 하나를 골라 주세요." }, { status: 400 });
    data.action = action;

    // 누른 시각 — 앱이 버튼을 누른 순간을 보낸다. 10분 넘게 지났거나 미래면 받지 않고 지금으로
    // (넓게 받으면 지각을 피하는 데 쓸 수 있다 — 결재 화면에는 실제 접수 시각도 함께 보인다)
    const pressed = typeof body.pressedAt === "string" ? new Date(body.pressedAt) : null;
    if (pressed && !Number.isNaN(pressed.getTime()) && pressed.getTime() <= now.getTime() && now.getTime() - pressed.getTime() <= 10 * 60_000) {
      data.requestedAt = pressed;
    }
    data.workDate = dateOfYmd(kstYmdOf(data.requestedAt));
    const ymd = kstYmdOf(data.requestedAt);

    if (kind === "OUTSIDE") {
      const reason = str(body.reason, 50);
      if (!reason) return NextResponse.json({ error: "사유를 골라 주세요." }, { status: 400 });
      data.reason = (OUTSIDE_REASONS as readonly string[]).includes(reason) ? reason : `기타: ${reason.replace(/^기타[:\s]*/, "")}`;
    }
    if (kind === "HQ" && !memo) return NextResponse.json({ error: "본부에 전할 내용을 적어 주세요." }, { status: 400 });

    const att = await prisma.attendance.findUnique({ where: { userId_date: { userId: session.userId, date: data.workDate } } });
    const pendingSame = await prisma.attendanceRequest.findFirst({
      where: { userId: session.userId, workDate: data.workDate, action, status: "PENDING", kind: { in: ["OUTSIDE", "PHOTO", "HQ"] } },
      select: { id: true },
    });
    if (pendingSame) return NextResponse.json({ error: `이미 ${action === "IN" ? "출근" : "퇴근"} 요청이 승인을 기다리고 있습니다.` }, { status: 409 });
    if (action === "IN") {
      if (att?.clockIn) return NextResponse.json({ error: "이미 출근 처리가 되어 있습니다." }, { status: 400 });
      const block = await weekendClockInBlock(session.userId, ymd);
      if (block) return NextResponse.json({ error: block }, { status: 403 });
    } else {
      if (att?.clockOut) return NextResponse.json({ error: "이미 퇴근 처리가 되어 있습니다." }, { status: 400 });
      // 출근 승인 대기 중이면 퇴근 요청도 받는다(#10)
      const pendingIn = await prisma.attendanceRequest.findFirst({
        where: { userId: session.userId, workDate: data.workDate, action: "IN", status: "PENDING" }, select: { id: true, clockOut: true },
      });
      // 퇴근 버튼으로 이미 출근 요청에 퇴근을 담았으면 퇴근 요청을 또 받지 않는다(퇴근이 두 갈래로 겹치지 않게)
      if (pendingIn?.clockOut) return NextResponse.json({ error: "이미 퇴근 처리가 되어 있습니다. (출근 요청 승인 대기 중)" }, { status: 400 });
      // 출근 요청 대기 중이어도 받는다 — 외근이면 퇴근도 지점 밖이다. 승인은 출근이 먼저 반영돼야 되고(applyApproved),
      // 출근 요청이 반려·취소되면 이 퇴근 요청도 함께 취소된다([id]/route.ts)
      if (!att?.clockIn && !pendingIn) return NextResponse.json({ error: "출근 기록이 없습니다. 출근부터 처리해 주세요." }, { status: 400 });
    }

    if (kind === "PHOTO") {
      if (!file) return NextResponse.json({ error: "지점 사진을 올려 주세요." }, { status: 400 });
      const ext = path.extname(file.name || "").toLowerCase() || ".jpg";
      if (!PHOTO_EXT.has(ext)) return NextResponse.json({ error: "사진 파일만 올릴 수 있습니다." }, { status: 400 });
      if (file.size > 10 * 1024 * 1024) return NextResponse.json({ error: "10MB 이하 사진만 올릴 수 있습니다." }, { status: 400 });
      const buf = Buffer.from(await file.arrayBuffer());
      // 파일 내용도 사진인지 본다(확장자만 바꾼 다른 파일을 막는다)
      const head = buf.subarray(0, 12);
      const isImage =
        (head[0] === 0xff && head[1] === 0xd8) ||                                            // JPEG
        head.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])) ||                 // PNG
        (head.subarray(0, 4).toString("ascii") === "RIFF" && head.subarray(8, 12).toString("ascii") === "WEBP") ||
        (head.subarray(4, 8).toString("ascii") === "ftyp" &&
          ["heic", "heix", "hevc", "heim", "heis", "mif1", "msf1"].includes(head.subarray(8, 12).toString("ascii")));   // HEIC
      if (!isImage) return NextResponse.json({ error: "사진 파일만 올릴 수 있습니다." }, { status: 400 });
      // 아이폰 HEIC 는 JPG 로 바꿔 저장한다(2026-10-23 ■1 — 본부 PC 에서 열리게). 못 바꾸면 원본 그대로
      const { heicToJpeg } = await import("@/lib/heic-jpeg");
      const jpg = await heicToJpeg(buf);
      await fs.mkdir(PHOTO_DIR, { recursive: true });
      const name = `${session.userId}-${Date.now()}${jpg ? ".jpg" : ext}`;
      await fs.writeFile(path.join(PHOTO_DIR, name), jpg ?? buf);
      data.photoPath = name;
    }
  } else {
    // CORRECTION · MISSED_OUT — 지난 기록 고치기
    const ymd = typeof body.workDate === "string" && YMD.test(body.workDate) ? body.workDate : null;
    if (!ymd || Number.isNaN(dateOfYmd(ymd).getTime())) return NextResponse.json({ error: "날짜를 확인해 주세요." }, { status: 400 });
    // 지난 기록만 고친다 — 오늘 출퇴근은 출퇴근 버튼(또는 지점 밖·사진·본부 요청)으로(위치·주말 확인을 건너뛰지 않게)
    if (ymd >= todayYmd) return NextResponse.json({ error: "오늘 출퇴근은 출퇴근 화면에서 처리해 주세요. 수정 요청은 지난 날짜만 됩니다." }, { status: 400 });
    if (dateOfYmd(todayYmd).getTime() - dateOfYmd(ymd).getTime() > 31 * 86400_000)
      return NextResponse.json({ error: "31일이 지난 기록은 본부에 직접 문의해 주세요." }, { status: 400 });
    data.workDate = dateOfYmd(ymd);
    data.reason = str(body.reason, 100);
    if (!data.reason) return NextResponse.json({ error: "사유를 적어 주세요." }, { status: 400 });

    const inStr = str(body.clockIn, 5);
    const outStr = str(body.clockOut, 5);
    const inAt = inStr ? kstDateTime(ymd, inStr) : null;
    let outAt = outStr ? kstDateTime(ymd, outStr) : null;
    if ((inStr && !inAt) || (outStr && !outAt)) return NextResponse.json({ error: "시각은 HH:mm 으로 넣어 주세요." }, { status: 400 });

    // 큐브티 출퇴근 시작(10/26) 전 날짜·시프티에서 옮긴 기록은 여기서 고치지 않는다 — 원본 보관(근로감독 대비), 고칠 일이 있으면 본부가 직접(2026-10-22 검증 5)
    if (ymd < CUBETEE_ATTENDANCE_START) return NextResponse.json({ error: "10/25까지의 출퇴근은 시프티 기록입니다. 고칠 일이 있으면 본부에 문의해 주세요." }, { status: 400 });
    const att = await prisma.attendance.findUnique({ where: { userId_date: { userId: session.userId, date: data.workDate } } });
    if (att?.importBatch) return NextResponse.json({ error: "시프티에서 옮겨 온 기록이라 여기서 고치지 않습니다. 본부에 문의해 주세요." }, { status: 400 });
    // 퇴근이 출근보다 이르면 다음 날 새벽 퇴근으로 본다(자정 넘긴 근무)
    const baseIn = inAt ?? att?.clockIn ?? null;
    if (outAt && baseIn && outAt <= baseIn) outAt = new Date(outAt.getTime() + 86400_000);
    if (outAt && outAt.getTime() > now.getTime()) return NextResponse.json({ error: "아직 오지 않은 시각입니다." }, { status: 400 });
    if (inAt && inAt.getTime() > now.getTime()) return NextResponse.json({ error: "아직 오지 않은 시각입니다." }, { status: 400 });

    if (kind === "MISSED_OUT") {
      if (!outAt) return NextResponse.json({ error: "퇴근 시각을 넣어 주세요." }, { status: 400 });
      if (!att?.clockIn) return NextResponse.json({ error: "그날 출근 기록이 없습니다. 기록 수정 요청으로 보내 주세요." }, { status: 400 });
      if (att.clockOut) return NextResponse.json({ error: "그날은 이미 퇴근 기록이 있습니다." }, { status: 400 });
      data.clockOut = outAt;
    } else {
      if (!inAt && !outAt) return NextResponse.json({ error: "고칠 출근 또는 퇴근 시각을 넣어 주세요." }, { status: 400 });
      if (!inAt && !att?.clockIn) return NextResponse.json({ error: "그날 출근 기록이 없습니다. 출근 시각도 넣어 주세요." }, { status: 400 });
      data.clockIn = inAt;
      data.clockOut = outAt;
    }
    const dup = await prisma.attendanceRequest.findFirst({
      where: { userId: session.userId, workDate: data.workDate, status: "PENDING", kind: { in: ["CORRECTION", "MISSED_OUT"] } },
      select: { id: true },
    });
    if (dup) return NextResponse.json({ error: "그날 기록 수정 요청이 이미 승인을 기다리고 있습니다." }, { status: 409 });
  }

  const approver = await resolveApprover({ id: session.userId, role: me.role, branch: me.branch }, kind);
  const row = await prisma.attendanceRequest.create({
    data: { userId: session.userId, ...data, approverRole: approver.approverRole, branch: approver.branch },
  });

  // 결재 차례인 사람에게 알림(원장 단계면 원장+대행, 본부 단계면 본부) + 본부 진행 알림.
  // 원장 단계 알림에는 시각을 싣지 않는다(■0-11 — 원장은 상태만, 「출퇴근 시각 보기」를 켜면 시각도)
  const managerTurn = approver.approverRole === "MANAGER";
  const period = managerTurn && !(await canSeeClockTimes("MANAGER")) ? statusSummaryOf(row) : summaryOf(row);
  const { botNotifyApprovalRequest } = await import("@/lib/bot");
  botNotifyApprovalRequest(
    { approverRole: approver.approverRole, branch: approver.branch, approverId: null },
    { kind: "출퇴근 요청", requesterName: me.name, period, requesterId: session.userId },
  ).catch(() => {});

  const approverLabel = !managerTurn ? "본부" : TWO_STEP_KINDS.includes(kind) ? "원장 → 본부" : "원장";
  return NextResponse.json({ success: true, id: row.id, approverLabel });
}
