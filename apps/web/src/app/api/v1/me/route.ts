import { NextRequest, NextResponse } from "next/server";
import { authenticateApiKey } from "@/lib/api-key";

export const dynamic = "force-dynamic";

// 키가 누구의 것이고 무엇을 할 수 있는지 — 범위와 무관하게 유효한 키면 답한다
export async function GET(request: NextRequest) {
  const a = await authenticateApiKey(request, null);
  if (a.ok === false) return a.res; // strictNullChecks 없이는 !a.ok 로 좁혀지지 않는다
  const { user, key } = a.p;
  return NextResponse.json({
    user: { id: user.id, name: user.name, branch: user.branch, jobGroup: user.jobGroup, position: user.position, role: user.role },
    key: { name: key.name, prefix: key.prefix, scopes: key.scopes, channelIds: key.channelIds, expiresAt: key.expiresAt },
    docs: "/api/v1/docs",
  });
}
