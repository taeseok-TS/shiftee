import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import fs from "fs/promises";
import path from "path";
import { postSignAccessError } from "@/lib/contract-access";
import { parseApprovalSteps, validateSteps, stepsLabel } from "@/lib/approval-order";
import { Prisma } from "@prisma/client";
import { logAudit } from "@/lib/audit";
import { parseFieldSettings, fieldSettingsDiff, type FieldSettings } from "@/lib/contract-field-settings";
import { parseLayout, layoutDiff, layoutToFieldSettings, type TemplateLayout } from "@/lib/contract-layout";

// 결재 순서(#213-2) 입력 → data 에 반영. "" 또는 "null" 이면 순서 없음(NULL)으로 되돌린다. 모양이 틀리면 오류 문구
function applyApprovalOrder(data: Record<string, unknown>, stepsRaw: unknown, lockedRaw: unknown): string | null {
  if (stepsRaw !== undefined && stepsRaw !== null) {
    if (stepsRaw === "" || stepsRaw === "null") data.approvalSteps = Prisma.DbNull;   // 지정 안 함 = SQL NULL
    else {
      const parsed = parseApprovalSteps(stepsRaw);
      if (!parsed) {
        let why = "";
        try { const v = typeof stepsRaw === "string" ? JSON.parse(stepsRaw) : stepsRaw; if (Array.isArray(v)) why = validateSteps(v) ?? ""; } catch { /* 모양 오류 */ }
        return `결재 순서가 올바르지 않습니다. ${why}`.trim();
      }
      data.approvalSteps = parsed;
    }
  }
  if (lockedRaw !== undefined && lockedRaw !== null) data.approvalLocked = lockedRaw === true || lockedRaw === "true";
  return null;
}

// 템플릿 한 건 조회(편집기·수정 창) — 관리자·원장
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || session.role === "EMPLOYEE") return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
  const { id } = await params;
  const template = await prisma.contractTemplate.findUnique({ where: { id }, include: { createdByUser: { select: { id: true, name: true } } } });
  if (!template) return NextResponse.json({ error: "템플릿을 찾을 수 없습니다." }, { status: 404 });
  return NextResponse.json({ template });
}

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
  let layoutWarn = "";   // 칸 배치가 있는 PDF 양식의 파일 교체 — 배치를 다시 봐야 한다는 안내(10/13 검증 7)
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
    const fsRaw = form.get("fieldSettings");   // 칸 설정(#22 1단계) — JSON 문자열
    if (typeof fsRaw === "string") data.fieldSettings = parseFieldSettings(fsRaw);

    if (name != null) data.name = name;
    if (description != null) data.description = description || null;
    if (type != null) data.type = type;
    if (postSignAccess != null && POST_SIGN_ACCESS.includes(postSignAccess)) data.postSignAccess = postSignAccess;
    {
      const e = applyApprovalOrder(data, form.get("approvalSteps"), form.get("approvalLocked"));
      if (e) return NextResponse.json({ error: e }, { status: 400 });
    }

    if (file && file.size > 0) {
      const buffer = Buffer.from(await file.arrayBuffer());
      const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 11)}-${file.name.replace(/[^a-zA-Z0-9.\-_가-힣]/g, "_")}`;
      const dir = path.join(process.cwd(), "uploads", "templates");
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, filename), buffer);
      data.fileUrl = `/api/uploads/templates/${filename}`;
      data.version = existing.version + 1; // 파일 교체 시 버전 증가
      if (existing.layout && /\.pdf$/i.test(existing.fileUrl)) {
        // 배치는 옛 PDF 의 쪽·자리 기준이다. 쪽 수가 다르면 밖으로 나간 칸이 조용히 버려지므로 꼭 알린다
        const { pdfPageCount } = await import("@/lib/contract-layout");
        const oldN = await fs.readFile(path.join(process.cwd(), "uploads", existing.fileUrl.replace(/^\/api\/uploads\//, ""))).then(pdfPageCount).catch(() => null);
        const newN = /\.pdf$/i.test(file.name) ? await pdfPageCount(buffer) : null;
        layoutWarn = !/\.pdf$/i.test(file.name) ? "워드 파일로 바꿔 칸 배치는 더 이상 쓰이지 않습니다(워드는 {칸} 태그로 자리를 잡습니다)"
          : oldN != null && newN != null && oldN !== newN ? `쪽 수가 ${oldN}→${newN}으로 달라져 칸 배치가 어긋날 수 있습니다 — 칸 배치 편집기에서 다시 확인하세요`
          : "칸 배치 편집기에서 칸 자리가 새 파일과 맞는지 확인하세요";
      }
    }
  } else {
    const body = await request.json();
    if (body.name != null) data.name = body.name;
    if (body.description !== undefined) data.description = body.description || null;
    if (body.type != null) data.type = body.type;
    if (body.postSignAccess != null && POST_SIGN_ACCESS.includes(body.postSignAccess)) data.postSignAccess = body.postSignAccess;
    {
      const e = applyApprovalOrder(data, body.approvalSteps, body.approvalLocked);
      if (body.fieldSettings !== undefined) data.fieldSettings = parseFieldSettings(body.fieldSettings);   // 칸 설정(#22 1단계)
      if (body.layout !== undefined) {   // PDF 칸 배치(#22 2단계, 편집기 저장) — 칸 설정도 배치에서 풀어 같이 저장(작성·서명 화면은 1단계 코드 그대로 돈다)
        if (!/\.pdf$/i.test(existing.fileUrl)) return NextResponse.json({ error: "칸 배치는 PDF 양식에만 저장할 수 있습니다." }, { status: 400 });
        const parsed = body.layout === null ? null : parseLayout(body.layout);
        data.layout = parsed ?? Prisma.DbNull;
        data.fieldSettings = layoutToFieldSettings(parsed);
      }
      if (e) return NextResponse.json({ error: e }, { status: 400 });
    }
    // 파일 주소는 템플릿 업로드 폴더 안의 것만(#78 검증 F9), 지금과 같으면 버전을 올리지 않는다(F5)
    if (body.fileUrl && body.fileUrl !== existing.fileUrl) {
      if (typeof body.fileUrl !== "string" || !body.fileUrl.startsWith("/api/uploads/templates/") || body.fileUrl.includes(".."))
        return NextResponse.json({ error: "파일 주소가 올바르지 않습니다." }, { status: 400 });
      // 같은 파일을 두 템플릿이 가리키면 칸 배치를 파일 주소로 찾는 치환이 엇갈린다(10/13 검증 8) — 막는다
      const sameFile = await prisma.contractTemplate.findFirst({ where: { fileUrl: body.fileUrl, NOT: { id } }, select: { name: true } });
      if (sameFile) return NextResponse.json({ error: `그 파일은 템플릿 「${sameFile.name}」이 쓰고 있습니다. 파일을 올려 교체하세요.` }, { status: 400 });
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
  // 감사 기록 — 누가 언제 무엇을 바꿨는지(이예지 대리 확인 요청 2026-10-12: 결재 순서 변경 이력). 바뀐 칸만 적는다
  {
    const changes: string[] = [];
    if (typeof data.name === "string" && data.name !== existing.name) changes.push(`이름 ${existing.name}→${data.name}`);
    if (typeof data.type === "string" && data.type !== existing.type) changes.push(`유형 ${existing.type}→${data.type}`);
    if (typeof data.postSignAccess === "string" && data.postSignAccess !== existing.postSignAccess) changes.push(`근로자 접근 ${existing.postSignAccess}→${data.postSignAccess}`);
    if (data.fileUrl && data.fileUrl !== existing.fileUrl) changes.push(`파일 교체 v${existing.version}→v${existing.version + 1}${layoutWarn ? " (칸 배치 재확인 필요)" : ""}`);
    if (Array.isArray(data.labels) && JSON.stringify(data.labels) !== JSON.stringify(existing.labels)) changes.push(`라벨 ${(data.labels as string[]).join(",") || "없음"}`);
    if (typeof data.pinned === "boolean" && data.pinned !== existing.pinned) changes.push(`맨 위 고정 ${data.pinned ? "켬" : "끔"}`);
    if ("approvalSteps" in data) {
      const before = parseApprovalSteps(existing.approvalSteps); const after = data.approvalSteps === Prisma.DbNull ? null : parseApprovalSteps(data.approvalSteps);
      const lab = (s: ReturnType<typeof parseApprovalSteps>) => (s ? stepsLabel(s) : "지정 안 함");
      if (lab(before) !== lab(after)) changes.push(`결재 순서 「${lab(before)}」→「${lab(after)}」`);
    }
    if (typeof data.approvalLocked === "boolean" && data.approvalLocked !== existing.approvalLocked) changes.push(`발송 때 순서 변경 ${data.approvalLocked ? "불가" : "허용"}`);
    if ("layout" in data) {   // 칸 배치(#22 2단계) — 추가·삭제·이동·설정 변경을 칸 단위로
      const d = layoutDiff(parseLayout(existing.layout), data.layout === Prisma.DbNull ? null : (data.layout as TemplateLayout));
      if (d.length) changes.push(`칸 배치 ${d.slice(0, 8).join(", ")}${d.length > 8 ? ` 외 ${d.length - 8}건` : ""}`);
    } else if ("fieldSettings" in data) {   // 누가·언제·어느 칸을 어떻게 바꿨는지(#22 요구)
      const d = fieldSettingsDiff(parseFieldSettings(existing.fieldSettings, { keepProtected: true }), data.fieldSettings as FieldSettings);   // 옛 저장값의 보호 칸이 사라지는 것도 기록에 남게
      if (d.length) changes.push(`칸 설정 ${d.slice(0, 8).join(", ")}${d.length > 8 ? ` 외 ${d.length - 8}칸` : ""}`);
    }
    if (changes.length) await logAudit({
      actorId: session.userId, actorName: session.name, action: "CONTRACT_TEMPLATE_UPDATE",
      targetType: "ContractTemplate", targetId: id, targetName: existing.name, detail: changes.join(" · "),
    });
  }
  return NextResponse.json({ success: true, template, ...(layoutWarn ? { warning: layoutWarn } : {}) });
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
