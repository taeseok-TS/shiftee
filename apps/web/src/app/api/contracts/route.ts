import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import fs from "fs/promises";
import path from "path";
import type { Contract, CreateContractRequest } from "@shiftee/api";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const where =
    session.role === "ADMIN"
      ? {}
      : session.role === "MANAGER"
      ? { user: { branch: session.branch } }
      : { userId: session.userId };

  const contracts = await prisma.contract.findMany({
    where,
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
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ contracts });
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

    // 템플릿 없을 때는 파일 필수, 템플릿 있을 때는 파일 불필수
    if ((files.length === 0 && !templateId) || !userId || !title || !type)
      return NextResponse.json(
        { error: "필수 정보가 누락되었습니다." },
        { status: 400 }
      );

    let fileUrl = "";

    if (files.length > 0) {
      const fileUrls: string[] = [];

      for (const file of files) {
        const bytes = await file.arrayBuffer();
        const buffer = Buffer.from(bytes);
        const timestamp = Date.now();
        const filename = `${timestamp}-${Math.random().toString(36).substr(2, 9)}-${file.name.replace(/[^a-zA-Z0-9.-]/g, "_")}`;
        const dir = path.join(process.cwd(), "uploads", "contracts");
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(path.join(dir, filename), buffer);
        fileUrls.push(`/api/uploads/contracts/${filename}`);
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
      fileUrl = JSON.stringify([template.fileUrl]);
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
        user: { select: { name: true, department: true } },
        approvalLine: {
          include: {
            steps: { include: { approver: { select: { name: true } } } },
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