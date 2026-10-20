import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { NOTE_EDITORS_PREFIX, canManageNoteEditors, noteEditorCandidates, noteEditorIds } from "@/lib/work-calendar";

// 「이달의 지점 공유」 메모 작성자 지정(2026-10-20 디렉터: 원장이나 원장이 지정한 사람이 작성).
// 원장(담당 지점)·관리자만. 지정할 수 있는 사람은 그 지점 소속 재직 직원뿐이다.

// GET ?branch=대치 → { candidates: [{id,name,position,jobGroup}], editorIds: [...] }
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  const branch = new URL(request.url).searchParams.get("branch") || "";
  if (!branch || !(await canManageNoteEditors(session, branch)))
    return NextResponse.json({ error: "이 지점의 작성자를 정할 권한이 없습니다." }, { status: 403 });

  const [candidates, ids] = await Promise.all([noteEditorCandidates(branch), noteEditorIds(branch)]);
  const valid = new Set(candidates.map((c) => c.id));
  return NextResponse.json({ candidates, editorIds: ids.filter((id) => valid.has(id)) }); // 다른 지점으로 옮겼거나 퇴사한 사람은 빼고 보여 준다
}

// PUT { branch, userIds } — 그 지점 재직 직원만 받는다(나머지는 거절)
export async function PUT(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  const body = await request.json().catch(() => null);
  const branch = typeof body?.branch === "string" ? body.branch : "";
  const userIds: unknown = body?.userIds;
  if (!branch || !Array.isArray(userIds) || userIds.some((x) => typeof x !== "string") || userIds.length > 200)
    return NextResponse.json({ error: "입력값이 올바르지 않습니다." }, { status: 400 });
  if (!(await canManageNoteEditors(session, branch)))
    return NextResponse.json({ error: "이 지점의 작성자를 정할 권한이 없습니다." }, { status: 403 });

  const candidates = await noteEditorCandidates(branch);
  const valid = new Set(candidates.map((c) => c.id));
  const ids = Array.from(new Set(userIds as string[]));
  if (ids.some((id) => !valid.has(id)))
    return NextResponse.json({ error: "이 지점 소속 직원만 지정할 수 있습니다." }, { status: 400 });

  const key = NOTE_EDITORS_PREFIX + branch;
  await prisma.appSetting.upsert({ where: { key }, create: { key, value: JSON.stringify(ids) }, update: { value: JSON.stringify(ids) } });
  return NextResponse.json({ success: true, editorIds: ids });
}
