import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { canViewSubmission, fileBelongsTo, resolveSubmissionViewer, submissionDiskPath } from "@/lib/submission-access";
import { pickJobGroups, serializeSubmission } from "@/lib/submission-server";
import { SUBMISSION_STATUSES, dateStr, normalizeFiles, todayStrKST } from "@/lib/submissions";
import fs from "fs/promises";
import type { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

const withRel = { category: true, request: { select: { id: true, title: true, dueDate: true, closedAt: true } } } as const;

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  const v = await resolveSubmissionViewer(session, null);
  if (!v) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  const { id } = await params;
  const s = await prisma.submission.findUnique({ where: { id }, include: withRel });
  if (!s || !canViewSubmission(s, v)) return NextResponse.json({ error: "자료를 찾을 수 없습니다." }, { status: 404 });
  return NextResponse.json({ submission: serializeSubmission(s) });
}

// 본인: 제목·메모·파일(확인 전까지) / 본부: 확인 상태·공유 설정
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  const v = await resolveSubmissionViewer(session, null);
  if (!v) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  const { id } = await params;
  const cur = await prisma.submission.findUnique({ where: { id }, include: withRel });
  if (!cur || cur.deletedAt || !canViewSubmission(cur, v)) return NextResponse.json({ error: "자료를 찾을 수 없습니다." }, { status: 404 });
  const body = await request.json().catch(() => ({}));
  const data: Prisma.SubmissionUpdateInput = {};
  const changes: string[] = [];
  const isOwner = cur.userId === v.userId;
  const isAdmin = v.role === "ADMIN";
  let shareChanged = false;

  // 본인 편집 — 본부가 확인한 뒤엔 잠긴다
  if (body.title !== undefined || body.memo !== undefined || body.files !== undefined) {
    if (!isOwner && !isAdmin) return NextResponse.json({ error: "본인 제출물만 고칠 수 있습니다." }, { status: 403 });
    if (isOwner && !isAdmin && cur.status === "CHECKED") return NextResponse.json({ error: "본부가 확인한 자료는 고칠 수 없습니다." }, { status: 400 });
    if (!isAdmin && cur.publishedAt) return NextResponse.json({ error: "블로그에 발행된 자료는 고칠 수 없습니다." }, { status: 400 });
    // 파일 교체는 삭제와 같은 선 — 마감 지남·닫힌 요청이면 본인은 못 바꾼다(검증관 6)
    if (isOwner && !isAdmin && body.files !== undefined && cur.request) {
      const due = dateStr(cur.request.dueDate);
      if (due && due < todayStrKST()) return NextResponse.json({ error: "마감이 지난 제출물의 파일은 바꿀 수 없습니다." }, { status: 400 });
      const req = await prisma.submissionRequest.findUnique({ where: { id: cur.request.id }, select: { closedAt: true } });
      if (req?.closedAt) return NextResponse.json({ error: "닫힌 요청의 제출물은 바꿀 수 없습니다." }, { status: 400 });
    }
    if (typeof body.title === "string") { const t = body.title.trim().slice(0, 150); if (!t) return NextResponse.json({ error: "제목을 입력해주세요." }, { status: 400 }); if (t !== cur.title) { data.title = t; changes.push("제목"); } }
    if (typeof body.memo === "string") { data.memo = body.memo.trim().slice(0, 1000) || null; changes.push("메모"); }
    if (body.files !== undefined) {
      const files = normalizeFiles(body.files);
      if (!files) return NextResponse.json({ error: "파일을 1~10개 올려주세요." }, { status: 400 });
      for (const f of files) {
        // 이미 이 제출물에 있던 파일은 그대로, 새로 붙는 파일은 본인이 올린 것만
        const already = (Array.isArray(cur.files) ? (cur.files as unknown as { url: string }[]) : []).some((x) => x.url === f.url);
        if (!already && !fileBelongsTo(f.url, v.userId) && !isAdmin) return NextResponse.json({ error: `본인이 올린 파일만 넣을 수 있습니다: ${f.name}` }, { status: 400 });
        const p = submissionDiskPath(f.url);
        const st = p ? await fs.stat(p).catch(() => null) : null;
        if (!st?.isFile()) return NextResponse.json({ error: `파일을 찾을 수 없습니다: ${f.name}` }, { status: 400 });
        f.size = st.size;
        const taken = await prisma.submission.findFirst({ where: { id: { not: id }, files: { array_contains: [{ url: f.url }] } }, select: { id: true } });
        if (taken) return NextResponse.json({ error: `이미 다른 제출물에 있는 파일입니다: ${f.name}` }, { status: 409 });
      }
      data.files = files as unknown as Prisma.InputJsonValue; changes.push(`파일 ${files.length}개`);
    }
  }

  // 본부 — 확인 / 공유
  if (body.status !== undefined || body.shared !== undefined || body.shareJobGroups !== undefined) {
    if (!isAdmin) return NextResponse.json({ error: "본부 관리자만 확인·공유할 수 있습니다." }, { status: 403 });
    if (body.status !== undefined) {
      if (!(SUBMISSION_STATUSES as readonly string[]).includes(body.status)) return NextResponse.json({ error: "상태가 올바르지 않습니다." }, { status: 400 });
      if (body.status !== cur.status) {
        data.status = body.status;
        data.checkedBy = body.status === "CHECKED" ? v.userId : null;
        data.checkedAt = body.status === "CHECKED" ? new Date() : null;
        changes.push(body.status === "CHECKED" ? "확인" : "확인 취소");
      }
    }
    if (body.shared !== undefined || body.shareJobGroups !== undefined) {
      const shared = body.shared !== undefined ? !!body.shared : cur.shared;
      const groups = body.shareJobGroups !== undefined ? pickJobGroups(body.shareJobGroups, true) : cur.shareJobGroups;
      if (!groups) return NextResponse.json({ error: "공유 대상이 올바르지 않습니다." }, { status: 400 });
      if (shared && !groups.length) return NextResponse.json({ error: "공유 대상을 하나 이상 골라주세요." }, { status: 400 });
      const sameGroups = groups.length === cur.shareJobGroups.length && groups.every((g) => cur.shareJobGroups.includes(g));
      if (shared !== cur.shared || !sameGroups) {
        data.shared = shared;
        data.shareJobGroups = shared ? groups : [];
        data.sharedBy = shared ? v.userId : null;
        data.sharedAt = shared ? new Date() : null;
        shareChanged = shared; // 켜지거나 대상이 바뀌면 알린다
        changes.push(shared ? `공유 켬(${groups.map((g) => (g === "*" ? "전체" : g)).join("/")})` : "공유 끔");
      }
    }
  }

  if (!changes.length) return NextResponse.json({ error: "바꿀 내용이 없습니다." }, { status: 400 });
  const row = await prisma.submission.update({ where: { id }, data, include: withRel });
  await logAudit({
    actorId: v.userId, actorName: v.name,
    action: changes.some((c) => c.startsWith("공유")) ? (row.shared ? "SUBMISSION_SHARE_ON" : "SUBMISSION_SHARE_OFF") : changes.includes("확인") ? "SUBMISSION_CHECK" : "SUBMISSION_UPDATE",
    targetType: "SUBMISSION", targetId: id, targetName: row.title, detail: `${row.userBranch ?? ""} ${row.userName} · ${changes.join(", ")}`,
  });
  if (shareChanged) {
    const { notifyShared } = await import("@/lib/submission-notify");
    void notifyShared(id);
  }
  return NextResponse.json({ submission: serializeSubmission(row) });
}

// 삭제(숨김) — 본인은 확인 전·마감 전까지, 본부는 언제나. 파일은 디스크에 남는다(본부만 볼 수 있음).
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  const v = await resolveSubmissionViewer(session, null);
  if (!v) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  const { id } = await params;
  const cur = await prisma.submission.findUnique({ where: { id }, include: withRel });
  if (!cur || cur.deletedAt || !canViewSubmission(cur, v)) return NextResponse.json({ error: "자료를 찾을 수 없습니다." }, { status: 404 });
  if (v.role !== "ADMIN") {
    if (cur.userId !== v.userId) return NextResponse.json({ error: "본인 제출물만 지울 수 있습니다." }, { status: 403 });
    if (cur.status === "CHECKED") return NextResponse.json({ error: "본부가 확인한 자료는 지울 수 없습니다." }, { status: 400 });
    if (cur.publishedAt) return NextResponse.json({ error: "블로그에 발행된 자료는 지울 수 없습니다." }, { status: 400 });
    const due = dateStr(cur.request?.dueDate ?? null);
    if (due && due < todayStrKST()) return NextResponse.json({ error: "마감이 지난 제출물은 지울 수 없습니다." }, { status: 400 });
    if (cur.request?.closedAt) return NextResponse.json({ error: "닫힌 요청의 제출물은 지울 수 없습니다." }, { status: 400 });
  }
  await prisma.submission.update({ where: { id }, data: { deletedAt: new Date() } });
  await logAudit({ actorId: v.userId, actorName: v.name, action: "SUBMISSION_DELETE", targetType: "SUBMISSION", targetId: id, targetName: cur.title, detail: `${cur.userBranch ?? ""} ${cur.userName}` });
  return NextResponse.json({ success: true });
}
