import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import fs from "fs/promises";
import path from "path";
import { logAudit } from "@/lib/audit";

// 템플릿 사본(#78) — 파일을 새 이름으로 복사해 새 템플릿(v1)을 만든다. 이름은 「○○ (사본)」, 겹치면 (사본 2)…
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") return NextResponse.json({ error: "템플릿 사본은 관리자만 만들 수 있습니다." }, { status: 403 });
  const { id } = await params;
  const src = await prisma.contractTemplate.findUnique({ where: { id } });
  if (!src || !src.isActive) return NextResponse.json({ error: "템플릿을 찾을 수 없습니다." }, { status: 404 });

  // 파일 복사 — uploads/templates 안의 파일만
  const rel = src.fileUrl.replace(/^\/api\/uploads\//, "");
  if (!rel.startsWith("templates/") || rel.includes("..")) return NextResponse.json({ error: "템플릿 파일 경로가 올바르지 않습니다." }, { status: 400 });
  const base = path.basename(rel).replace(/^\d+-[a-z0-9]+-/, "");
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 11)}-${base}`;
  const dir = path.join(process.cwd(), "uploads", "templates");
  try {
    await fs.copyFile(path.join(process.cwd(), "uploads", rel), path.join(dir, filename));
  } catch {
    return NextResponse.json({ error: "템플릿 파일을 복사하지 못했습니다." }, { status: 500 });
  }

  let name = `${src.name} (사본)`;
  for (let n = 2; await prisma.contractTemplate.findUnique({ where: { name } }); n++) name = `${src.name} (사본 ${n})`;
  let copy;
  try {
    copy = await prisma.contractTemplate.create({
      data: {
        name, description: src.description, type: src.type, fileUrl: `/api/uploads/templates/${filename}`, version: 1,
        createdBy: session.userId, approverIds: src.approverIds, postSignAccess: src.postSignAccess, labels: src.labels,
      },
    });
  } catch {
    // 같은 사본을 동시에 두 번 만들면 이름이 겹친다 — 복사한 파일을 지우고 다시 누르게 한다(#78 검증 F6)
    await fs.unlink(path.join(dir, filename)).catch(() => {});
    return NextResponse.json({ error: "사본을 만들지 못했습니다. 다시 눌러 주세요." }, { status: 409 });
  }
  await logAudit({ actorId: session.userId, actorName: session.name, action: "CONTRACT_TEMPLATE_COPY", targetType: "ContractTemplate", targetId: copy.id, targetName: copy.name, detail: `원본: ${src.name} v${src.version}` });
  return NextResponse.json({ success: true, template: copy });
}
