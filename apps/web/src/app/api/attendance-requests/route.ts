import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { verifyAttendanceDevice } from "@/lib/device";
import { kstTodayYmd } from "@/lib/holidays";
import { getManagerBranches } from "@/lib/manager-branches";
import {
  KIND_LABEL, OUTSIDE_REASONS, dateOfYmd, kstDateTime, kstYmdOf, resolveApprover, inboxWhere, summaryOf,
  weekendClockInBlock, type RequestKind,
} from "@/lib/attendance-request";

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

function shapeRow(r: {
  id: string; userId: string; kind: string; action: string | null; workDate: Date; requestedAt: Date; clockIn: Date | null;
  clockOut: Date | null; reason: string | null; memo: string | null; photoPath: string | null; deviceName: string | null;
  platform: string | null; approverRole: string; branch: string | null; status: string; decidedAt: Date | null;
  rejectReason: string | null; createdAt: Date; latitude: number | null; longitude: number | null;
  user: { name: string; branch: string | null; position: string | null };
}, deciderNames: Map<string, string>, decidedBy: string | null) {
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
    reason: r.reason,
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
    createdAt: r.createdAt,
    summary: summaryOf(r),
  };
}

const ROW_SELECT = {
  id: true, userId: true, kind: true, action: true, workDate: true, requestedAt: true, clockIn: true, clockOut: true,
  reason: true, memo: true, photoPath: true, deviceName: true, platform: true, approverRole: true, branch: true,
  status: true, decidedBy: true, decidedAt: true, rejectReason: true, createdAt: true, latitude: true, longitude: true,
  user: { select: { name: true, branch: true, position: true } },
} as const;

// GET ?scope=mine(기본) | inbox(내가 처리할 대기) | history(관리자 전체·원장 담당 지점, 최근 60일)
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  const scope = new URL(request.url).searchParams.get("scope") || "mine";
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
  return NextResponse.json({ requests: rows.map((r) => shapeRow(r, names, r.decidedBy)) });
}

// POST — JSON(OUTSIDE·HQ·CORRECTION·MISSED_OUT) 또는 multipart(PHOTO: file + 칸들)
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
  if (!["OUTSIDE", "PHOTO", "HQ", "CORRECTION", "MISSED_OUT"].includes(kind))
    return NextResponse.json({ error: "요청 종류가 올바르지 않습니다." }, { status: 400 });

  const me = await prisma.user.findUnique({ where: { id: session.userId }, select: { name: true, role: true, branch: true } });
  if (!me) return NextResponse.json({ error: "사용자를 찾을 수 없습니다." }, { status: 404 });
  if (me.role === "ADMIN") return NextResponse.json({ error: "관리자는 출퇴근 기록을 직접 수정할 수 있어 요청이 필요 없습니다." }, { status: 400 });

  const memo = str(body.memo, 200);
  const latitude = num(body.latitude);
  const longitude = num(body.longitude);
  const now = new Date();
  const todayYmd = kstTodayYmd();

  const data: {
    kind: RequestKind; action: string | null; workDate: Date; requestedAt: Date; clockIn: Date | null; clockOut: Date | null;
    reason: string | null; memo: string | null; latitude: number | null; longitude: number | null; photoPath: string | null;
  } = { kind, action: null, workDate: dateOfYmd(todayYmd), requestedAt: now, clockIn: null, clockOut: null, reason: null, memo, latitude, longitude, photoPath: null };

  if (kind === "OUTSIDE" || kind === "PHOTO" || kind === "HQ") {
    // 출퇴근 대신이므로 출근 버튼과 같은 기기 검증(대리 출퇴근 방지)
    const deviceError = await verifyAttendanceDevice(session.userId, session.role, request.headers.get("x-device-id"));
    if (deviceError) return NextResponse.json({ error: deviceError }, { status: 403 });

    const action = body.action === "IN" || body.action === "OUT" ? body.action : null;
    if (!action) return NextResponse.json({ error: "출근·퇴근 중 하나를 골라 주세요." }, { status: 400 });
    data.action = action;

    // 누른 시각 — 앱이 버튼을 누른 순간을 보낸다. 10분 넘게 지났거나 미래면 받지 않고 지금으로
    // (넓게 받으면 지각을 피하는 데 쓸 수 있다 — 결재 화면에는 실제 접수 시각도 함께 보인다)
    const pressed = typeof body.pressedAt === "string" ? new Date(body.pressedAt) : null;
    if (pressed && !Number.isNaN(pressed.getTime()) && pressed.getTime() <= now.getTime() + 60_000 && now.getTime() - pressed.getTime() <= 10 * 60_000) {
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
        where: { userId: session.userId, workDate: data.workDate, action: "IN", status: "PENDING" }, select: { id: true },
      });
      if (!att?.clockIn && !pendingIn) return NextResponse.json({ error: "출근 기록이 없습니다. 출근부터 처리해 주세요." }, { status: 400 });
      if (pendingIn) return NextResponse.json({ error: "출근 요청이 승인을 기다리고 있습니다. 퇴근은 퇴근 버튼으로 찍어 주세요." }, { status: 409 });
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
        head.subarray(4, 8).toString("ascii") === "ftyp";                                    // HEIC
      if (!isImage) return NextResponse.json({ error: "사진 파일만 올릴 수 있습니다." }, { status: 400 });
      await fs.mkdir(PHOTO_DIR, { recursive: true });
      const name = `${session.userId}-${Date.now()}${ext}`;
      await fs.writeFile(path.join(PHOTO_DIR, name), buf);
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

    const att = await prisma.attendance.findUnique({ where: { userId_date: { userId: session.userId, date: data.workDate } } });
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

  // 결재 차례인 사람에게 알림(원장 단계면 원장+대행, 본부 단계면 본부) + 본부 진행 알림
  const { botNotifyApprovalRequest } = await import("@/lib/bot");
  botNotifyApprovalRequest(
    { approverRole: approver.approverRole, branch: approver.branch, approverId: null },
    { kind: "출퇴근 요청", requesterName: me.name, period: summaryOf(row), requesterId: session.userId },
  ).catch(() => {});

  return NextResponse.json({ success: true, id: row.id, approverLabel: approver.approverRole === "ADMIN" ? "본부" : "원장" });
}
