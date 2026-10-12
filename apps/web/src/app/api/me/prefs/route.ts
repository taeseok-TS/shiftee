import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

// 내 화면 설정(2026-10-12 QA #73 정렬·표시·주 시작 요일) — **사람마다** 저장해 다른 PC·브라우저에서도 따라온다.
//  · AppSetting 표에 `userpref:<userId>` 한 줄(JSON). 새 표 없이(DDL 없음) 쓴다.
//  · 최상위 키는 허용 목록만(schedule …). 값은 JSON 객체, 키마다 4KB 까지. 서버는 내용을 해석하지 않는다(화면이 검증).
//  GET → { userId, prefs: { schedule?: {...} } } / PUT { schedule: {...} } → 그 키만 바꾼다(다른 키는 유지), null 이면 지운다
//  userId 를 실어 주는 이유: 화면 훅이 같은 브라우저에서 사람이 바뀐 것을 알아채기 위해(10/12 검증 1)
const ALLOWED = ["schedule"] as const;
const MAX_BYTES = 4096;
const keyOf = (userId: string) => `userpref:${userId}`;

async function load(userId: string): Promise<Record<string, unknown>> {
  const row = await prisma.appSetting.findUnique({ where: { key: keyOf(userId) } });
  if (!row) return {};
  try { const v = JSON.parse(row.value); return v && typeof v === "object" && !Array.isArray(v) ? v : {}; } catch { return {}; }
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  return NextResponse.json({ userId: session.userId, prefs: await load(session.userId) });
}

export async function PUT(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "설정 형식이 올바르지 않습니다." }, { status: 400 });
  const keys = Object.keys(body);
  const bad = keys.filter((k) => !(ALLOWED as readonly string[]).includes(k));
  if (bad.length) return NextResponse.json({ error: `저장할 수 없는 설정: ${bad.join(", ")}` }, { status: 400 });
  if (!keys.length) return NextResponse.json({ error: "바꿀 설정이 없습니다." }, { status: 400 });
  const cur = await load(session.userId);
  for (const k of keys) {
    const v = body[k];
    if (v === null) { delete cur[k]; continue; }
    if (!v || typeof v !== "object" || Array.isArray(v)) return NextResponse.json({ error: `${k} 설정은 객체여야 합니다.` }, { status: 400 });
    if (Buffer.byteLength(JSON.stringify(v), "utf8") > MAX_BYTES) return NextResponse.json({ error: `${k} 설정이 너무 큽니다(4KB까지).` }, { status: 400 });
    cur[k] = v;
  }
  const value = JSON.stringify(cur);
  await prisma.appSetting.upsert({ where: { key: keyOf(session.userId) }, create: { key: keyOf(session.userId), value }, update: { value } });
  return NextResponse.json({ userId: session.userId, prefs: cur });
}
