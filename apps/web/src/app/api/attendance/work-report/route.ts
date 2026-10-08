import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getManagerBranches } from "@/lib/manager-branches";
import { isRealDate } from "@/lib/schedule-payload";
import { workReport } from "@/lib/work-report";

export const dynamic = "force-dynamic";

const dateOf = (ymd: string) => { const [y, m, d] = ymd.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); };

// 근로시간 리포트(2026-10-08 QA76 #41) — GET ?from&to&branches=a,b&emp=active|resigned|all. 본부 전 지점, 원장 담당 지점만
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role !== "ADMIN" && session.role !== "MANAGER") return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
  const sp = new URL(request.url).searchParams;
  const from = sp.get("from") || "", to = sp.get("to") || "";
  if (!isRealDate(from) || !isRealDate(to) || from > to) return NextResponse.json({ error: "기간을 확인해 주세요." }, { status: 400 });
  if (dateOf(to).getTime() - dateOf(from).getTime() > 186 * 86400_000) return NextResponse.json({ error: "한 번에 186일(약 6개월)까지 볼 수 있습니다." }, { status: 400 });
  const emp = sp.get("emp") === "resigned" ? "resigned" : sp.get("emp") === "all" ? "all" : "active";
  const wanted = (sp.get("branches") || "").split(",").map((s) => s.trim()).filter(Boolean);
  let branches: string[] | null;
  if (session.role === "MANAGER") {
    const own = await getManagerBranches(session.userId);
    branches = wanted.length ? wanted.filter((b) => own.includes(b)) : own;
    if (branches.length === 0) return NextResponse.json({ error: "담당 지점이 없습니다." }, { status: 403 });
  } else {
    branches = wanted.length ? wanted : null;
  }
  const { rows, truncated } = await workReport({ from, to, branches, emp });
  return NextResponse.json({ from, to, rows, truncated });
}
