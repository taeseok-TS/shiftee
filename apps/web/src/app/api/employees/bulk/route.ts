import { NextRequest, NextResponse } from "next/server";
import { getSession, isSuperAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import bcryptjs from "bcryptjs";
import { currentLeaveYear } from "@/lib/leave-calc";
import { logAudit } from "@/lib/audit";

// 엑셀 셀 값은 숫자/날짜 등 아무 타입이나 올 수 있음 (예: 비밀번호 12345678 → number)
interface BulkEmployee {
  name?: unknown;
  email?: unknown;
  password?: unknown;
  phone?: unknown;
  department?: unknown;
  branch?: unknown;
  jobGroup?: unknown;
  position?: unknown;
  role?: unknown;
  hireDate?: unknown;
  birthDate?: unknown;
  empNo?: unknown;
}

// 엑셀 값 → 문자열 (숫자 비밀번호·연락처 등 대응). 비면 null
const str = (v: unknown): string | null => {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
};

// 입사일: 문자열("2024-01-01") 또는 엑셀 날짜 시리얼(숫자) 모두 지원
const parseHireDate = (v: unknown): Date | null => {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v === "number" && isFinite(v)) {
    // 엑셀 시리얼: 1899-12-30 기준 경과 일수
    return new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
  }
  const d = new Date(String(v).trim());
  return isNaN(d.getTime()) ? null : d;
};

// 역할: 영문/한글 모두 허용
const ROLE_MAP: Record<string, "ADMIN" | "MANAGER" | "EMPLOYEE"> = {
  ADMIN: "ADMIN", MANAGER: "MANAGER", EMPLOYEE: "EMPLOYEE",
  관리자: "ADMIN", 원장: "MANAGER", 직원: "EMPLOYEE",
};

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  }

  if (session.role === "EMPLOYEE") {
    return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
  }

  try {
    // updateExisting: 기존 직원(이메일 기준)이면 오류 대신 적힌 컬럼만 갱신 (일괄 정보 수정 모드)
    const { employees: data, updateExisting } = await request.json();

    if (!Array.isArray(data) || data.length === 0) {
      return NextResponse.json({ error: "직원 데이터가 없습니다." }, { status: 400 });
    }

    let created = 0;
    let updated = 0;
    let failed = 0;
    const errors: string[] = [];

    // 관리자(ADMIN) 계정 생성은 메인 관리자 전용
    const canCreateAdmin = await isSuperAdmin(session.userId);

    // 지점 검증은 DB의 실제 활성 지점 기준 (구 A~O 매핑표 사용 금지 — 실지점 등록 후 무효화됨)
    const activeBranches = new Set(
      (await prisma.branch.findMany({ where: { isActive: true }, select: { name: true } })).map((b) => b.name)
    );

    for (let i = 0; i < data.length; i++) {
      const row = data[i] as BulkEmployee;
      const rowNum = i + 2; // 헤더는 1번 행

      try {
        const name = str(row.name);
        const email = str(row.email);
        const password = str(row.password);

        // 이메일은 매칭·생성 공통 필수
        if (!email) {
          errors.push(`${rowNum}번 행: 이메일은 필수입니다.`);
          failed++;
          continue;
        }

        // 역할: 적혀 있으면 검증 (업데이트 모드에서 비어 있으면 기존 유지)
        const roleRaw = str(row.role);
        const roleParsed = roleRaw ? (ROLE_MAP[roleRaw.toUpperCase()] ?? null) : null;
        if (roleRaw && !roleParsed) {
          errors.push(`${rowNum}번 행: 역할이 올바르지 않습니다. (${roleRaw}) — ADMIN/MANAGER/EMPLOYEE 또는 관리자/원장/직원`);
          failed++;
          continue;
        }
        if (roleParsed === "ADMIN" && !canCreateAdmin) {
          errors.push(`${rowNum}번 행: 관리자 계정 생성·변경은 메인 관리자만 가능합니다.`);
          failed++;
          continue;
        }

        // 지점 검증 (DB 실지점 이름과 정확히 일치해야 함)
        const branch = str(row.branch);
        if (branch && !activeBranches.has(branch)) {
          errors.push(`${rowNum}번 행: 등록되지 않은 지점입니다. (${branch})`);
          failed++;
          continue;
        }

        // 사원번호 파싱 (지정된 경우만)
        let empNoProvided: number | undefined;
        const empNoRaw = str(row.empNo);
        if (empNoRaw) {
          const n = parseInt(empNoRaw);
          if (!Number.isInteger(n) || n <= 0) {
            errors.push(`${rowNum}번 행: 사원번호는 양의 정수여야 합니다. (${empNoRaw})`);
            failed++;
            continue;
          }
          empNoProvided = n;
        }

        const existing = await prisma.user.findUnique({
          where: { email },
          select: { id: true, empNo: true },
        });

        // ── 기존 직원: 업데이트 모드면 적힌 컬럼만 갱신, 아니면 중복 오류 ──
        if (existing) {
          if (!updateExisting) {
            errors.push(`${rowNum}번 행: 이미 존재하는 이메일입니다. (${email})`);
            failed++;
            continue;
          }
          if (empNoProvided !== undefined && empNoProvided !== existing.empNo) {
            const dupNo = await prisma.user.findUnique({ where: { empNo: empNoProvided }, select: { id: true, name: true } });
            if (dupNo && dupNo.id !== existing.id) {
              errors.push(`${rowNum}번 행: 사원번호 ${empNoProvided}은(는) 이미 ${dupNo.name}님이 사용 중입니다.`);
              failed++;
              continue;
            }
          }
          const patch: Record<string, unknown> = {};
          if (name) patch.name = name;
          if (str(row.phone)) patch.phone = str(row.phone);
          if (branch) patch.branch = branch;
          if (str(row.jobGroup)) patch.jobGroup = str(row.jobGroup);
          if (str(row.position)) patch.position = str(row.position);
          if (roleParsed) patch.role = roleParsed;
          const hd = parseHireDate(row.hireDate);
          if (hd) patch.hireDate = hd;
          const bd = parseHireDate(row.birthDate);
          if (bd) patch.birthDate = bd;
          if (empNoProvided !== undefined) patch.empNo = empNoProvided;
          // 비밀번호는 업데이트 모드에서 변경하지 않음 (실수 방지)
          if (Object.keys(patch).length === 0) {
            errors.push(`${rowNum}번 행: 변경할 값이 없습니다. (${email})`);
            failed++;
            continue;
          }
          await prisma.user.update({ where: { id: existing.id }, data: patch });
          updated++;
          continue;
        }

        // ── 신규 생성 ──
        if (!name || !password) {
          errors.push(`${rowNum}번 행: 신규 등록에는 이름·비밀번호가 필수입니다.`);
          failed++;
          continue;
        }
        const role = roleParsed ?? "EMPLOYEE";

        // 비밀번호 해싱 (엑셀에서 숫자로 읽혀도 문자열로 변환됨)
        const hashedPassword = await bcryptjs.hash(password, 10);

        // 사원번호: 지정돼 있으면 그 번호(중복 검사), 비어 있으면 순차 자동 발급(1001~)
        let empNo: number;
        if (empNoProvided !== undefined) {
          const dupNo = await prisma.user.findUnique({ where: { empNo: empNoProvided }, select: { name: true } });
          if (dupNo) {
            errors.push(`${rowNum}번 행: 사원번호 ${empNoProvided}은(는) 이미 ${dupNo.name}님이 사용 중입니다.`);
            failed++;
            continue;
          }
          empNo = empNoProvided;
        } else {
          const maxNo = (await prisma.user.aggregate({ _max: { empNo: true } }))._max.empNo ?? 1000;
          empNo = Math.max(1000, maxNo) + 1;
        }
        // 직원 생성
        const user = await prisma.user.create({
          data: {
            name,
            email,
            password: hashedPassword,
            empNo,
            phone: str(row.phone),
            department: str(row.department),
            branch,
            jobGroup: str(row.jobGroup),
            position: str(row.position),
            role,
            hireDate: parseHireDate(row.hireDate),
            birthDate: parseHireDate(row.birthDate), // 생년월일 (봇 생일 축하용) — 날짜 파싱 규칙 동일
          },
        });

        // LeaveBalance 초기화 (연차 15일)
        await prisma.leaveBalance.create({
          data: {
            userId: user.id,
            year: currentLeaveYear(),
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

    if (updated > 0) {
      await logAudit({
        actorId: session.userId,
        actorName: session.name,
        action: "EMPLOYEE_BULK_UPDATE",
        targetType: "USER",
        detail: `엑셀 일괄 수정 — ${updated}명 정보 갱신 (신규 ${created}명, 실패 ${failed}명)`,
      });
    }

    return NextResponse.json({
      success: true,
      created,
      updated,
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
