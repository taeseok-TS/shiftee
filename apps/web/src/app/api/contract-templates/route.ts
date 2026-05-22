import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";

export async function GET() {
  const session = await getSession();
  if (!session || session.role === "EMPLOYEE") {
    return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
  }

  try {
    const templates = await prisma.contractTemplate.findMany({
      where: { isActive: true },
      include: {
        createdByUser: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ templates });
  } catch (error) {
    console.error("템플릿 조회 실패:", error);
    return NextResponse.json({ error: "템플릿을 조회할 수 없습니다." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session || session.role === "EMPLOYEE") {
    return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File;
    const name = formData.get("name") as string;
    const description = formData.get("description") as string;
    const type = formData.get("type") as string;
    const approverIdsJson = formData.get("approverIds") as string;

    if (!file || !name || !type) {
      return NextResponse.json({ error: "필수 정보가 부족합니다." }, { status: 400 });
    }

    // 파일 저장
    const uploadDir = join(process.cwd(), "uploads", "templates");
    mkdirSync(uploadDir, { recursive: true });

    const filename = `${Date.now()}-${file.name}`;
    const filepath = join(uploadDir, filename);
    const buffer = await file.arrayBuffer();
    writeFileSync(filepath, Buffer.from(buffer));

    const fileUrl = `/api/uploads/templates/${filename}`;

    // 템플릿 생성
    const template = await prisma.contractTemplate.create({
      data: {
        name,
        description: description || null,
        type,
        fileUrl,
        createdBy: session.userId,
        approverIds: approverIdsJson || "[]",
      },
      include: {
        createdByUser: { select: { id: true, name: true } },
      },
    });

    return NextResponse.json({ success: true, template });
  } catch (error) {
    console.error("템플릿 생성 실패:", error);
    return NextResponse.json({ error: "템플릿을 생성할 수 없습니다." }, { status: 500 });
  }
}
