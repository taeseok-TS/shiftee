import { NextRequest, NextResponse } from "next/server";
import { getSession, isSuperAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { normalizeBranchName } from "@/lib/branches";
import bcryptjs from "bcryptjs";

interface BulkEmployee {
  name?: string;
  email?: string;
  password?: string;
  phone?: string;
  department?: string;
  branch?: string;
  jobGroup?: string;
  position?: string;
  role?: string;
  hireDate?: string;
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  }

  if (session.role === "EMPLOYEE") {
    return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
  }

  try {
    const { employees: data } = await request.json();

    if (!Array.isArray(data) || data.length === 0) {
      return NextResponse.json({ error: "직원 데이터가 없습니다." }, { status: 400 });
    }

    let created = 0;
    let failed = 0;
    const errors: string[] = [];

    // 관리자(ADMIN) 계정 생성은 메인 관리자 전용
    const canCreateAdmin = await isSuperAdmin(session.userId);

    for (let i = 0; i < data.length; i++) {
      const row = data[i] as BulkEmployee;
      const rowNum = i + 2; // 헤더는 1번 행

      try {
        // 필수 필드 검증
        if (!row.name || !row.email || !row.password) {
          errors.push(`${rowNum}번 행: 이름, 이메일, 비밀번호는 필수입니다.`);
          failed++;
          continue;
        }

        // 서브 관리자는 ADMIN 계정 일괄 생성 불가
        if (row.role === "ADMIN" && !canCreateAdmin) {
          errors.push(`${rowNum}번 행: 관리자 계정 생성은 메인 관리자만 가능합니다.`);
          failed++;
          continue;
        }

        // 이메일 중복 체크
        const existing = await prisma.user.findUnique({
          where: { email: row.email },
        });

        if (existing) {
          errors.push(`${rowNum}번 행: 이미 존재하는 이메일입니다. (${row.email})`);
          failed++;
          continue;
        }

        // 비밀번호 해싱
        const hashedPassword = await bcryptjs.hash(row.password, 10);

        // 지점 정규화
        let normalizedBranch = null;
        if (row.branch) {
          normalizedBranch = normalizeBranchName(row.branch);
          if (!normalizedBranch) {
            errors.push(`${rowNum}번 행: 유효하지 않은 지점입니다. (${row.branch})`);
            failed++;
            continue;
          }
        }

        // 직원 생성
        const user = await prisma.user.create({
          data: {
            name: row.name,
            email: row.email,
            password: hashedPassword,
            phone: row.phone || null,
            department: row.department || null,
            branch: normalizedBranch,
            jobGroup: row.jobGroup || null,
            position: row.position || null,
            role: (row.role || "EMPLOYEE") as "ADMIN" | "MANAGER" | "EMPLOYEE",
            hireDate: row.hireDate ? new Date(row.hireDate) : null,
          },
        });

        // LeaveBalance 초기화 (연차 15일)
        await prisma.leaveBalance.create({
          data: {
            userId: user.id,
            year: new Date().getFullYear(),
            total: 15,
            used: 0,
            remaining: 15,
          },
        });

        created++;
      } catch (error) {
        console.error(`${rowNum}번 행 처리 오류:`, error);
        errors.push(`${rowNum}번 행: 처리 중 오류가 발생했습니다.`);
        failed++;
      }
    }

    return NextResponse.json({
      success: true,
      created,
      failed,
      total: data.length,
      errors: errors.slice(0, 10), // 최대 10개 오류만 반환
    });
  } catch (error) {
    console.error("벌크 업로드 오류:", error);
    return NextResponse.json(
      { error: "파일 처리 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
