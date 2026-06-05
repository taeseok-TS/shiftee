import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import fs from "fs/promises";
import path from "path";

// 템플릿 목록 조회
export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }

    // 직원(EMPLOYEE)은 조회 불가
    if (session.role === "EMPLOYEE") {
      return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const type = searchParams.get("type");

    let where: any = { isActive: true };
    if (type) {
      where.type = type;
    }

    const templates = await prisma.contractTemplate.findMany({
      where,
      include: {
        createdByUser: {
          select: { id: true, name: true, email: true }
        }
      },
      orderBy: { createdAt: "desc" }
    });

    return NextResponse.json({ templates });
  } catch (error) {
    console.error("GET /api/contract-templates 에러:", error);
    return NextResponse.json(
      { error: "템플릿 조회에 실패했습니다." },
      { status: 500 }
    );
  }
}

// 템플릿 생성/업로드
export async function POST(request: NextRequest) {
  const session = await getSession();

  // 관리자와 매니저만 템플릿 생성 가능
  if (!session || session.role === "EMPLOYEE") {
    return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File;
    const name = formData.get("name") as string;
    const description = formData.get("description") as string;
    const type = formData.get("type") as string;

    if (!file || !name || !type) {
      return NextResponse.json(
        { error: "파일, 이름, 타입은 필수입니다." },
        { status: 400 }
      );
    }

    // 중복 이름 체크
    const existingTemplate = await prisma.contractTemplate.findUnique({
      where: { name }
    });

    if (existingTemplate) {
      return NextResponse.json(
        { error: "이미 존재하는 템플릿 이름입니다." },
        { status: 400 }
      );
    }

    // 파일 저장
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const timestamp = Date.now();
    const filename = `${timestamp}-${Math.random().toString(36).substr(2, 9)}-${file.name.replace(/[^a-zA-Z0-9.-]/g, "_")}`;
    const dir = path.join(process.cwd(), "uploads", "templates");

    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, filename), buffer);

    const fileUrl = `/api/uploads/templates/${filename}`;

    // DB에 템플릿 저장
    const template = await prisma.contractTemplate.create({
      data: {
        name,
        description: description || null,
        type,
        fileUrl,
        version: 1,
        isActive: true,
        createdBy: session.userId,
        approverIds: "[]" // 기본값: 빈 배열
      },
      include: {
        createdByUser: {
          select: { id: true, name: true, email: true }
        }
      }
    });

    return NextResponse.json({ success: true, template });
  } catch (error) {
    console.error("POST /api/contract-templates 에러:", error);
    return NextResponse.json(
      { error: "템플릿 업로드에 실패했습니다." },
      { status: 500 }
    );
  }
}
