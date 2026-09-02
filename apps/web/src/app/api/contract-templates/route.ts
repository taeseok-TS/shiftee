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

  // 템플릿 생성은 관리자 전용
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "템플릿 등록은 관리자만 가능합니다." }, { status: 403 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File;
    const name = formData.get("name") as string;
    const description = formData.get("description") as string;
    const type = formData.get("type") as string;
    // 서명 완료 후 근로자 접근 정책. 종전에는 POST 가 이 값을 안 받아 **항상 full 로** 생겼다.
    // 정책은 계약이 가리키는 템플릿 행에서 읽으므로, 사직원을 "새로 등록 → 구버전 비활성"
    // 방식으로 교체하는 순간 그날 발송분이 전부 열린다(경고도 없이). 값을 받고,
    // 안 주면 **같은 이름의 이전 템플릿 값을 승계**한다 — 교체 사고를 원천 차단한다.
    const accessRaw = (formData.get("postSignAccess") as string | null)?.trim();

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

    // 정책 결정: 명시값 > 같은 이름의 이전 템플릿 승계 > full(종전 동작)
    let postSignAccess: string;
    if (accessRaw === "none" || accessRaw === "view" || accessRaw === "full") {
      postSignAccess = accessRaw;
    } else {
      // "사직원 (구버전)" 처럼 뒤에 붙여 만드는 교체 관행을 감안해 접두 일치로 찾는다
      const base = name.replace(/\s*\((구|신)?\s*v?\d*버?전?\)\s*$/, "").trim();
      const prev = await prisma.contractTemplate.findFirst({
        where: { name: { startsWith: base } },
        orderBy: { createdAt: "desc" },
        select: { postSignAccess: true, name: true },
      });
      postSignAccess = prev?.postSignAccess || "full";
      if (prev) console.info(`[템플릿] "${name}" 접근정책을 "${prev.name}"에서 승계: ${postSignAccess}`);
    }

    // DB에 템플릿 저장
    const template = await prisma.contractTemplate.create({
      data: {
        name,
        description: description || null,
        type,
        fileUrl,
        version: 1,
        isActive: true,
        postSignAccess,
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
