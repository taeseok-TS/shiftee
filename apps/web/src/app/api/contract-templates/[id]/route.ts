import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import fs from "fs/promises";
import path from "path";

// 템플릿 수정 (관리자/원장) — 이름·설명·유형 수정, 파일 교체 시 버전 증가.
// FormData(파일 포함) 또는 JSON(메타만) 둘 다 받는다.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  // 템플릿 수정은 관리자 전용
  if (!session || session.role !== "ADMIN")
    return NextResponse.json({ error: "템플릿 수정은 관리자만 가능합니다." }, { status: 403 });

  const { id } = await params;
  const existing = await prisma.contractTemplate.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "템플릿을 찾을 수 없습니다." }, { status: 404 });

  const data: Record<string, unknown> = {};
  const ct = request.headers.get("content-type") || "";

  if (ct.includes("multipart/form-data")) {
    const form = await request.formData();
    const name = form.get("name") as string | null;
    const description = form.get("description") as string | null;
    const type = form.get("type") as string | null;
    const file = form.get("file") as File | null;

    if (name != null) data.name = name;
    if (description != null) data.description = description || null;
    if (type != null) data.type = type;

    if (file && file.size > 0) {
      const buffer = Buffer.from(await file.arrayBuffer());
      const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 11)}-${file.name.replace(/[^a-zA-Z0-9.\-_가-힣]/g, "_")}`;
      const dir = path.join(process.cwd(), "uploads", "templates");
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, filename), buffer);
      data.fileUrl = `/api/uploads/templates/${filename}`;
      data.version = existing.version + 1; // 파일 교체 시 버전 증가
    }
  } else {
    const body = await request.json();
    if (body.name != null) data.name = body.name;
    if (body.description !== undefined) data.description = body.description || null;
    if (body.type != null) data.type = body.type;
    if (body.fileUrl) { data.fileUrl = body.fileUrl; data.version = existing.version + 1; }
  }

  // 이름 변경 시 중복 검사
  if (typeof data.name === "string" && data.name !== existing.name) {
    const dup = await prisma.contractTemplate.findUnique({ where: { name: data.name } });
    if (dup) return NextResponse.json({ error: "이미 존재하는 템플릿 이름입니다." }, { status: 400 });
  }

  const template = await prisma.contractTemplate.update({ where: { id }, data });
  return NextResponse.json({ success: true, template });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();

  // 템플릿 삭제는 관리자 전용
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "템플릿 삭제는 관리자만 가능합니다." }, { status: 403 });
  }

  try {
    const { id } = await params;

    // 템플릿 존재 확인
    const template = await prisma.contractTemplate.findUnique({
      where: { id },
      include: {
        contracts: { select: { id: true } }
      }
    });

    if (!template) {
      return NextResponse.json(
        { error: "템플릿을 찾을 수 없습니다." },
        { status: 404 }
      );
    }

    // 이 템플릿을 사용 중인 계약서가 있으면 삭제 불가
    if (template.contracts.length > 0) {
      return NextResponse.json(
        { error: "이 템플릿을 사용 중인 계약서가 있어서 삭제할 수 없습니다." },
        { status: 400 }
      );
    }

    // 템플릿 비활성화 (soft delete 방식)
    const deletedTemplate = await prisma.contractTemplate.update({
      where: { id },
      data: { isActive: false }
    });

    return NextResponse.json({ success: true, template: deletedTemplate });
  } catch (error) {
    console.error("DELETE /api/contract-templates/[id] 에러:", error);
    return NextResponse.json(
      { error: "템플릿 삭제에 실패했습니다." },
      { status: 500 }
    );
  }
}
