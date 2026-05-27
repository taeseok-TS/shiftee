import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import fs from "fs/promises";
import path from "path";

/**
 * GET /api/contract-templates
 * 조직의 계약서 템플릿 목록 (ADMIN/MANAGER만)
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(
        { error: "인증이 필요합니다." },
        { status: 401 }
      );
    }

    // ADMIN 또는 MANAGER만 접근 가능
    if (session.role !== "ADMIN" && session.role !== "MANAGER") {
      return NextResponse.json(
        { error: "접근 권한이 없습니다." },
        { status: 403 }
      );
    }

    // 매니저는 같은 지점의 템플릿만 조회 가능
    const templates = await prisma.contractTemplate.findMany({
      where: {
        isActive: true,
      },
      select: {
        id: true,
        name: true,
        description: true,
        type: true,
        version: true,
        createdBy: true,
        createdByUser: {
          select: { id: true, name: true },
        },
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: "desc" },
    });

    return NextResponse.json({
      success: true,
      templates,
      total: templates.length,
    });
  } catch (error) {
    console.error("템플릿 조회 오류:", error);
    return NextResponse.json(
      { error: "템플릿 조회 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}

/**
 * POST /api/contract-templates
 * 새 계약서 템플릿 생성 (ADMIN/MANAGER만)
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(
        { error: "인증이 필요합니다." },
        { status: 401 }
      );
    }

    // ADMIN 또는 MANAGER만 생성 가능
    if (session.role !== "ADMIN" && session.role !== "MANAGER") {
      return NextResponse.json(
        { error: "접근 권한이 없습니다." },
        { status: 403 }
      );
    }

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const name = formData.get("name") as string;
    const description = formData.get("description") as string | null;
    const type = formData.get("type") as string;
    const approverIdsStr = formData.get("approverIds") as string | null;

    if (!name || !type || !file) {
      return NextResponse.json(
        { error: "필수 항목이 누락되었습니다." },
        { status: 400 }
      );
    }

    // 템플릿 이름 중복 확인
    const existing = await prisma.contractTemplate.findUnique({
      where: { name },
    });

    if (existing) {
      return NextResponse.json(
        { error: "이미 존재하는 템플릿 이름입니다." },
        { status: 409 }
      );
    }

    // 파일 업로드
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const timestamp = Date.now();
    const filename = `${timestamp}-${Math.random().toString(36).substr(2, 9)}-${file.name.replace(/[^a-zA-Z0-9.-]/g, "_")}`;
    const dir = path.join(process.cwd(), "uploads", "templates");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, filename), buffer);
    const fileUrl = `/api/uploads/templates/${filename}`;

    // approverIds 파싱
    let approverIds: string[] = [];
    try {
      if (approverIdsStr) {
        approverIds = JSON.parse(approverIdsStr);
      }
    } catch {
      approverIds = [];
    }

    const template = await prisma.contractTemplate.create({
      data: {
        name,
        description: description || null,
        type,
        fileUrl,
        version: 1,
        isActive: true,
        createdBy: session.userId,
        approverIds: JSON.stringify(approverIds),
      },
      select: {
        id: true,
        name: true,
        description: true,
        type: true,
        version: true,
        createdBy: true,
        createdByUser: {
          select: { id: true, name: true },
        },
        createdAt: true,
      },
    });

    return NextResponse.json({
      success: true,
      message: "템플릿이 생성되었습니다.",
      template,
    });
  } catch (error) {
    console.error("템플릿 생성 오류:", error);
    return NextResponse.json(
      { error: "템플릿 생성 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
