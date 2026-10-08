import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import fs from "fs/promises";
import path from "path";
import { postSignAccessError } from "@/lib/contract-access";

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
  // 서명 완료 후 근로자 접근 (#129) — full(열람+다운로드) | view(열람만) | none(접근 불가)
  const POST_SIGN_ACCESS = ["full", "view", "none"];

  if (ct.includes("multipart/form-data")) {
    const form = await request.formData();
    const name = form.get("name") as string | null;
    const description = form.get("description") as string | null;
    const type = form.get("type") as string | null;
    const postSignAccess = form.get("postSignAccess") as string | null;
    const file = form.get("file") as File | null;
    const labelsRaw = form.get("labels") as string | null;
    if (labelsRaw != null) data.labels = cleanLabels(labelsRaw);

    if (name != null) data.name = name;
    if (description != null) data.description = description || null;
    if (type != null) data.type = type;
    if (postSignAccess != null && POST_SIGN_ACCESS.includes(postSignAccess)) data.postSignAccess = postSignAccess;

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
    if (body.postSignAccess != null && POST_SIGN_ACCESS.includes(body.postSignAccess)) data.postSignAccess = body.postSignAccess;
    // 파일 주소는 템플릿 업로드 폴더 안의 것만(#78 검증 F9), 지금과 같으면 버전을 올리지 않는다(F5)
    if (body.fileUrl && body.fileUrl !== existing.fileUrl) {
      if (typeof body.fileUrl !== "string" || !body.fileUrl.startsWith("/api/uploads/templates/") || body.fileUrl.includes(".."))
        return NextResponse.json({ error: "파일 주소가 올바르지 않습니다." }, { status: 400 });
      data.fileUrl = body.fileUrl; data.version = existing.version + 1;
    }
    if (body.labels !== undefined) data.labels = cleanLabels(body.labels);
    if (typeof body.pinned === "boolean") data.pinned = body.pinned;
  }

  // 이름 변경 시 중복 검사
  if (typeof data.name === "string" && data.name !== existing.name) {
    const dup = await prisma.contractTemplate.findUnique({ where: { name: data.name } });
    if (dup) return NextResponse.json({ error: "이미 존재하는 템플릿 이름입니다." }, { status: 400 });
  }

  // 파일을 바꾸면 바뀌기 전 파일·버전을 이력에 남긴다(#78) — 같은 트랜잭션에서
  // 근로계약서를 「접근 불가」로 바꾸는 것은 막는다(#213-1) — 이름·유형·접근 중 바뀌는 값과 기존 값을 합쳐 판정
  {
    const effName = typeof data.name === "string" ? data.name : existing.name;
    const effType = typeof data.type === "string" ? data.type : existing.type;
    const effAccess = typeof data.postSignAccess === "string" ? data.postSignAccess : existing.postSignAccess;
    const accessErr = postSignAccessError(effName, effType, effAccess);
    if (accessErr) return NextResponse.json({ error: accessErr }, { status: 400 });
  }

  const template = await prisma.$transaction(async (tx) => {
    if (data.fileUrl && data.fileUrl !== existing.fileUrl) {
      await tx.contractTemplateVersion.create({
        data: { templateId: id, version: existing.version, fileUrl: existing.fileUrl, replacedBy: session.userId },
      });
    }
    return tx.contractTemplate.update({ where: { id }, data });
  });
  return NextResponse.json({ success: true, template });
}

// 라벨(#78) — 쉼표 구분 글자 또는 배열 → 앞뒤 공백 제거·빈 값·중복 제거, 최대 10개·각 20자
function cleanLabels(v: unknown): string[] {
  const arr = Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : [];
  return [...new Set(arr.filter((x): x is string => typeof x === "string").map((x) => x.trim().slice(0, 20)).filter(Boolean))].slice(0, 10);
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
