import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { authenticateApiKey, v1Error } from "@/lib/api-key";
import { prisma } from "@/lib/db";
import { isResigned } from "@/lib/resign";
import { ensureNoticeBot, noticeBotSendDM } from "@/lib/bot";

export const dynamic = "force-dynamic";

// 외부 시스템 → 직원 1:1 DM (2026-10-20 이예지 요청: 직영 포털 START SETTING 완료 → 담당 매니저에게 「START CHECK 진행해 주세요」).
// 회사 연동 키(ORG, scope dm:send)로만. 보내는 사람은 「에듀플렉스 알림」 시스템 계정(로그인·목록에 안 나옴).
//   POST /api/v1/dm   Authorization: Bearer cbt_pk_…
//   { "empNo": "06582" | 6582, "empNos"?: [...], "text": "보낼 내용", "refId"?: "start-setting-123" }
//   → 200 { results: [{ empNo, status: "sent"|"duplicate"|"failed", reason?, name? }], sent, duplicate, failed }
//   refId 가 있으면 (키, refId, 사번) 이 같은 알림은 다시 보내지 않는다(duplicate). 실패한 것은 같은 refId 로 다시 보내면 다시 시도한다.
//   한도: 키당 분당 쓰기 10회·하루 2,000회(lib/api-key), 요청 하나에 받는 사람 50명까지,
//         키당 하루 받는 사람 3,000명·한 사람이 같은 키로 하루 30건까지(키가 새도 전 직원 스팸이 되지 않게 — 검증 지적).
const MAX_TEXT = 2000;
const MAX_RECIPIENTS = 50;
const MAX_PER_KEY_DAY = 3000;
const MAX_PER_PERSON_DAY = 30;
const kstDayStart = () => { const k = new Date(Date.now() + 9 * 3600_000); return new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate()) - 9 * 3600_000); };

type Result = { empNo: string; status: "sent" | "duplicate" | "failed"; reason?: string; name?: string };

/** "06582"·6582 → 6582. 숫자 아닌 것·0 이하는 null */
function parseEmpNo(v: unknown): number | null {
  const s = typeof v === "number" ? String(v) : typeof v === "string" ? v.trim() : "";
  if (!/^\d{1,9}$/.test(s)) return null;
  const n = parseInt(s, 10);
  return n > 0 ? n : null;
}

export async function POST(request: NextRequest) {
  const a = await authenticateApiKey(request, "dm:send", "write");
  if (a.ok === false) return a.res;
  if (a.p.key.kind !== "ORG") return v1Error(403, "회사 연동 키로만 쓸 수 있습니다.", "ORG_KEY_ONLY");
  const keyId = a.p.key.id;

  const body = (await request.json().catch(() => null)) as { empNo?: unknown; empNos?: unknown; text?: unknown; refId?: unknown } | null;
  if (!body) return v1Error(400, "JSON 본문이 필요합니다.", "BAD_JSON");
  const text = typeof body.text === "string" ? body.text.replace(/\r\n/g, "\n").trim() : "";
  if (!text) return v1Error(400, "text(보낼 내용)가 필요합니다.", "NO_TEXT");
  if (text.length > MAX_TEXT) return v1Error(400, `text 는 ${MAX_TEXT.toLocaleString()}자까지입니다.`, "TEXT_TOO_LONG");
  let refId: string | null = null;
  if (body.refId != null) {
    if (typeof body.refId !== "string" || !body.refId.trim() || body.refId.trim().length > 120) return v1Error(400, "refId 는 1~120자 문자열이어야 합니다.", "BAD_REF_ID");
    refId = body.refId.trim();
  }
  const rawList: unknown[] = Array.isArray(body.empNos) ? body.empNos : body.empNo != null ? [body.empNo] : [];
  if (!rawList.length) return v1Error(400, "empNo(사번) 또는 empNos(사번 목록)가 필요합니다.", "NO_RECIPIENT");
  if (rawList.length > MAX_RECIPIENTS) return v1Error(400, `한 번에 ${MAX_RECIPIENTS}명까지 보낼 수 있습니다.`, "TOO_MANY_RECIPIENTS");

  // 발신 계정 준비(한 번) — 실패하면 아무에게도 보내지 않고 알린다(기록을 「처리 중」에 가두지 않게)
  try { await ensureNoticeBot(); } catch (e) {
    console.error("[v1/dm] 발신 계정 준비 실패:", e);
    return v1Error(503, "발신 계정을 준비하지 못했습니다. 잠시 뒤 다시 보내 주세요.", "SENDER_UNAVAILABLE");
  }
  const dayStart = kstDayStart();
  const keyToday = await prisma.externalDm.count({ where: { keyId, createdAt: { gte: dayStart } } });
  if (keyToday + rawList.length > MAX_PER_KEY_DAY) return v1Error(429, `이 키로는 하루 ${MAX_PER_KEY_DAY.toLocaleString()}명까지 보낼 수 있습니다(오늘 ${keyToday.toLocaleString()}명).`, "RATE_DM_DAY");

  const results: Result[] = [];
  const seen = new Set<number>();
  for (const raw of rawList) {
    const label = typeof raw === "string" || typeof raw === "number" ? String(raw) : JSON.stringify(raw);
    const empNo = parseEmpNo(raw);
    if (empNo == null) { results.push({ empNo: label, status: "failed", reason: "BAD_EMPNO" }); continue; }
    if (seen.has(empNo)) { results.push({ empNo: label, status: "duplicate", reason: "SAME_REQUEST" }); continue; }
    seen.add(empNo);

    // 같은 알림 두 번 방지 — refId 가 있으면 먼저 자리를 잡는다(동시에 두 번 와도 하나만 보낸다)
    let rowId: string | null = null;
    if (refId) {
      try {
        rowId = (await prisma.externalDm.create({ data: { keyId, refId, empNo, status: "PENDING" }, select: { id: true } })).id;
      } catch (e) {
        if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e;
        const prev = await prisma.externalDm.findUnique({ where: { keyId_refId_empNo: { keyId, refId, empNo } }, select: { id: true, status: true } });
        // 실패했던 건만 다시 시도한다(보냈거나 보내는 중이면 duplicate). 다시 잡을 때도 조건부로 — 동시 재시도가 둘 다 보내지 않게
        const retake = prev && prev.status === "FAILED"
          ? await prisma.externalDm.updateMany({ where: { id: prev.id, status: "FAILED" }, data: { status: "PENDING", reason: null } })
          : { count: 0 };
        if (!prev || retake.count === 0) { results.push({ empNo: label, status: "duplicate", reason: "SAME_REF_ID" }); continue; }
        rowId = prev.id;
      }
    }

    // 여기부터 오류가 나도 그 사람만 「실패」로 남긴다 — 자리(PENDING)에 갇혀 같은 refId 로 영영 못 보내는 일이 없게(검증 지적)
    let user: { id: string; name: string } | null = null;
    let reason: string | null = null;
    let ok = false;
    try {
      // 한 사람이 같은 키로 하루 받는 건수 상한 — refId 중복 판정 **뒤에** 센다(이미 보낸 refId 는 한도와 상관없이 duplicate, 재검증 지적).
      // 방금 잡은 자리(rowId)는 빼고 센다
      const personToday = await prisma.externalDm.count({ where: { keyId, empNo, createdAt: { gte: dayStart }, ...(rowId ? { NOT: { id: rowId } } : {}) } });
      const u = personToday >= MAX_PER_PERSON_DAY ? undefined : await prisma.user.findUnique({
        where: { empNo },
        select: { id: true, name: true, isActive: true, deletedAt: true, employmentStatus: true, resignDate: true },
      });
      user = u ? { id: u.id, name: u.name } : null;
      if (u === undefined) reason = "RATE_PERSON_DAY";
      else if (!u || u.deletedAt) reason = "NOT_FOUND";
      else if (u.employmentStatus === "RESIGNED" || isResigned(u.resignDate)) reason = "RESIGNED";
      else if (!u.isActive) reason = "INACTIVE";
      if (!reason) {
        ok = await noticeBotSendDM(u!.id, text);
        if (!ok) reason = "SEND_ERROR";
      }
    } catch (e) {
      console.error("[v1/dm] 보내기 오류:", e);
      ok = false; reason = "SEND_ERROR";
    }
    const data = { userId: user?.id ?? null, status: ok ? "SENT" : "FAILED", reason };
    if (rowId) await prisma.externalDm.update({ where: { id: rowId }, data }).catch(() => {});
    else await prisma.externalDm.create({ data: { keyId, refId: null, empNo, ...data } }).catch(() => {});
    results.push(ok ? { empNo: label, status: "sent", name: user!.name } : { empNo: label, status: "failed", reason: reason! });
  }

  const count = (s: Result["status"]) => results.filter((r) => r.status === s).length;
  return NextResponse.json({ results, sent: count("sent"), duplicate: count("duplicate"), failed: count("failed") });
}
