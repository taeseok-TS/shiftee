import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { filterContractData } from "@/lib/api-response";
import fs from "fs/promises";
import path from "path";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import type { Contract, CreateContractRequest } from "@shiftee/api";

// 워드(.docx) 템플릿의 치환 필드({직원명} 등)를 실제 값으로 채워 새 파일 생성
async function fillDocxTemplate(
  templateFileUrl: string,
  data: Record<string, string>
): Promise<string> {
  // "/api/uploads/templates/xxx.docx" → 실제 파일 경로
  const relPath = templateFileUrl.replace(/^\/api\/uploads\//, "");
  const srcPath = path.join(process.cwd(), "uploads", relPath);
  const content = await fs.readFile(srcPath);

  const zip = new PizZip(content);
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    delimiters: { start: "{", end: "}" },
    nullGetter: () => "", // 값이 없는 필드는 빈 문자열
  });
  doc.render(data);

  const buf = doc.getZip().generate({ type: "nodebuffer", compression: "DEFLATE" });
  const filename = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}-contract.docx`;
  const dir = path.join(process.cwd(), "uploads", "contracts");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, filename), buf);
  return `/api/uploads/contracts/${filename}`;
}

const fmtKoreanDate = (d: string | null) => {
  if (!d) return "";
  const date = new Date(d);
  if (isNaN(date.getTime())) return "";
  return `${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일`;
};

export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const year = searchParams.get("year");
    const month = searchParams.get("month");
    const status = searchParams.get("status");
    const userId = searchParams.get("userId");
    const searchText = searchParams.get("searchText");
    const showHiddenRevoked = searchParams.get("showHiddenRevoked") === "true";

    // 본인 계약서만 조회: EMPLOYEE는 항상, 그 외 역할은 scope=self 요청 시
    const selfOnly = session.role === "EMPLOYEE" || searchParams.get("scope") === "self";

    // 기본 권한 필터
    let whereBase: any = selfOnly
      ? { userId: session.userId }
      : session.role === "ADMIN"
      ? {}
      : session.role === "MANAGER"
      ? { user: { branch: session.branch } }
      : { userId: session.userId };

    // 추가 필터 적용
    if (year) {
      const yearNum = parseInt(year);
      const startOfYear = new Date(yearNum, 0, 1);
      const endOfYear = new Date(yearNum + 1, 0, 1);
      whereBase.createdAt = { gte: startOfYear, lt: endOfYear };
    }

    if (month && year) {
      const yearNum = parseInt(year);
      const monthNum = parseInt(month) - 1; // JS에서는 0부터 시작
      const startOfMonth = new Date(yearNum, monthNum, 1);
      const endOfMonth = new Date(yearNum, monthNum + 1, 1);
      whereBase.createdAt = { gte: startOfMonth, lt: endOfMonth };
    }

    if (status) {
      whereBase.status = status;
    }

    if (userId && !selfOnly) {
      whereBase.userId = userId;
    }

    if (searchText && searchText.trim()) {
      whereBase.title = { contains: searchText.trim(), mode: "insensitive" };
    }

    const contracts = await prisma.contract.findMany({
      where: whereBase,
      include: {
        user: { select: { id: true, name: true, email: true, department: true, branch: true } },
        approvalLine: {
          include: {
            steps: {
              include: { approver: { select: { id: true, name: true, email: true, branch: true } } },
              orderBy: { order: "asc" },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    // 데이터 필터링 적용: 직원 정보에서 이메일 제거 (부분 노출)
    const filteredContracts = contracts.map(contract => ({
      ...contract,
      user: {
        id: contract.user.id,
        name: contract.user.name,
        department: contract.user.department,
        branch: contract.user.branch,
      },
      approvalLine: contract.approvalLine ? {
        ...contract.approvalLine,
        steps: (contract.approvalLine.steps || []).map(step => ({
          ...step,
          approver: {
            id: step.approver.id,
            name: step.approver.name,
            branch: step.approver.branch,
          },
        })),
      } : null,
    }));

    return NextResponse.json({ contracts: filteredContracts });
  } catch (error) {
    console.error("GET /api/contracts 에러:", error);
    return NextResponse.json({ error: "계약서 조회에 실패했습니다." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session || session.role === "EMPLOYEE")
    return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });

  try {
    const formData = await request.formData();
    const files = formData.getAll("files") as File[];
    const templateId = formData.get("templateId") as string | null;
    const userId = formData.get("userId") as string;
    const title = formData.get("title") as string;
    const type = formData.get("type") as string;
    const startDate = formData.get("startDate") as string;
    const endDate = formData.get("endDate") as string;
    const salary = formData.get("salary") as string | null;

    // 템플릿 없을 때는 파일 필수, 템플릿 있을 때는 파일 불필수
    if ((files.length === 0 && !templateId) || !userId || !title || !type)
      return NextResponse.json(
        { error: "필수 정보가 누락되었습니다." },
        { status: 400 }
      );

    // MANAGER의 지점 검증: 자신의 지점 직원만 계약서 생성 가능
    if (session.role === "MANAGER") {
      const targetUser = await prisma.user.findUnique({
        where: { id: userId },
        select: { branch: true }
      });
      if (!targetUser || targetUser.branch !== session.branch) {
        return NextResponse.json({ error: "자신의 지점 직원만 계약서를 생성할 수 있습니다." }, { status: 403 });
      }
    }

    let fileUrl = "";

    if (files.length > 0) {
      const fileUrls: string[] = [];

      for (const file of files) {
        try {
          const bytes = await file.arrayBuffer();
          const buffer = Buffer.from(bytes);
          const timestamp = Date.now();
          const filename = `${timestamp}-${Math.random().toString(36).substr(2, 9)}-${file.name.replace(/[^a-zA-Z0-9.-]/g, "_")}`;
          const dir = path.join(process.cwd(), "uploads", "contracts");
          console.log("파일 저장 경로:", dir);
          console.log("파일명:", filename);
          await fs.mkdir(dir, { recursive: true });
          await fs.writeFile(path.join(dir, filename), buffer);
          console.log("파일 저장 성공:", filename);
          fileUrls.push(`/api/uploads/contracts/${filename}`);
        } catch (fileError) {
          console.error("파일 저장 중 에러:", fileError);
          throw fileError;
        }
      }

      // fileUrl에 JSON 배열로 저장 (첫 번째 파일을 기본값으로 사용)
      fileUrl = JSON.stringify(fileUrls);
    } else if (templateId) {
      // 템플릿에서 파일 URL 가져오기
      const template = await prisma.contractTemplate.findUnique({
        where: { id: templateId },
      });
      if (!template) {
        return NextResponse.json({ error: "템플릿을 찾을 수 없습니다." }, { status: 404 });
      }

      if (template.fileUrl.toLowerCase().endsWith(".docx")) {
        // 워드 템플릿: 치환 필드({직원명}, {연봉} 등)를 입력값으로 채워 계약서 생성
        const targetUser = await prisma.user.findUnique({
          where: { id: userId },
          select: { name: true, email: true, phone: true, branch: true, jobGroup: true, position: true, hireDate: true },
        });
        const now = new Date();
        const mergeData: Record<string, string> = {
          직원명: targetUser?.name ?? "",
          이름: targetUser?.name ?? "",
          이메일: targetUser?.email ?? "",
          연락처: targetUser?.phone ?? "",
          지점: targetUser?.branch ?? "",
          직책: targetUser?.jobGroup ?? "",
          직급: targetUser?.position ?? "",
          입사일: targetUser?.hireDate ? fmtKoreanDate(targetUser.hireDate.toISOString()) : "",
          제목: title,
          계약시작일: fmtKoreanDate(startDate),
          계약종료일: fmtKoreanDate(endDate),
          연봉: salary ? `${Number(salary).toLocaleString()}원` : "",
          작성일: fmtKoreanDate(now.toISOString()),
        };
        try {
          const filledUrl = await fillDocxTemplate(template.fileUrl, mergeData);
          fileUrl = JSON.stringify([filledUrl]);
        } catch (e) {
          console.error("워드 템플릿 치환 오류:", e);
          return NextResponse.json(
            { error: "워드 템플릿 처리 중 오류가 발생했습니다. 템플릿의 치환 필드({직원명} 등) 형식을 확인해주세요." },
            { status: 400 }
          );
        }
      } else {
        fileUrl = JSON.stringify([template.fileUrl]);
      }
    }

    const contract = await prisma.contract.create({
      data: {
        userId,
        title,
        type,
        fileUrl,
        startDate: startDate ? new Date(startDate) : null,
        endDate: endDate ? new Date(endDate) : null,
        status: "DRAFT",
      },
      include: {
        user: { select: { id: true, name: true, email: true, department: true, branch: true } },
        approvalLine: {
          include: {
            steps: {
              include: { approver: { select: { id: true, name: true, branch: true } } },
              orderBy: { order: "asc" },
            },
          },
        },
      },
    });

    return NextResponse.json({ success: true, contract });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "파일 업로드에 실패했습니다." }, { status: 500 });
  }
}