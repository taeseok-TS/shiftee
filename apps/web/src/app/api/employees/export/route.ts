import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import * as XLSX from "xlsx";

export const dynamic = "force-dynamic";

const ROLE_LABEL: Record<string, string> = { ADMIN: "관리자", MANAGER: "원장", EMPLOYEE: "직원" };

// 직원 명단 엑셀 다운로드 (관리자/원장)
export async function GET() {
  const session = await getSession();
  if (!session || session.role === "EMPLOYEE")
    return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });

  const branchWhere = session.role === "MANAGER" && session.branch ? { branch: session.branch } : {};
  const employees = await prisma.user.findMany({
    where: { isActive: true, role: { not: "ADMIN" }, ...branchWhere },
    select: { empNo: true, name: true, email: true, role: true, department: true, jobGroup: true, position: true, branch: true, hireDate: true, phone: true },
    orderBy: [{ branch: "asc" }, { empNo: "asc" }],
  });

  const rows = employees.map((e) => ({
    사원번호: e.empNo ?? "",
    이름: e.name,
    이메일: e.email,
    역할: ROLE_LABEL[e.role] ?? e.role,
    직군: e.jobGroup ?? "",
    직급: e.position ?? "",
    부서: e.department ?? "",
    지점: e.branch ?? "",
    입사일: e.hireDate ? new Date(e.hireDate).toISOString().slice(0, 10) : "",
    연락처: e.phone ?? "",
  }));

  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "직원목록");
  const buf: Buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  const fname = `직원목록_${new Date().toISOString().slice(0, 10)}.xlsx`;
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fname)}`,
    },
  });
}
