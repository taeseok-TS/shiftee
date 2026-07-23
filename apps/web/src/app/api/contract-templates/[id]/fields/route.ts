import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import PizZip from "pizzip";
import fs from "fs/promises";
import path from "path";
import { scanEmployeeFillFields } from "@/lib/contract-fields";

// 템플릿 워드(.docx)에 들어 있는 치환 필드({...}) 목록 조회.
// 계약서 작성 폼이 이 목록으로 템플릿별 추가 입력란을 자동 구성한다.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session || session.role === "EMPLOYEE")
    return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });

  const { id } = await params;
  const template = await prisma.contractTemplate.findUnique({ where: { id }, select: { fileUrl: true } });
  if (!template) return NextResponse.json({ error: "템플릿을 찾을 수 없습니다." }, { status: 404 });
  if (!template.fileUrl.toLowerCase().endsWith(".docx"))
    return NextResponse.json({ fields: [] });

  try {
    const rel = template.fileUrl.replace(/^\/api\/uploads\//, "");
    const buf = await fs.readFile(path.join(process.cwd(), "uploads", rel));
    const zip = new PizZip(buf);
    const xml = zip.file("word/document.xml")?.asText() || "";

    // 문단 단위로 텍스트를 이어붙여, 워드가 run을 쪼개 놓은 태그도 인식.
    // {#조건}...{/조건} 구간을 추적해 각 필드가 어떤 계약 구분에서만 쓰이는지도 반환.
    const fields: string[] = [];
    const conditions = new Set<string>();
    const fieldConditions: Record<string, string> = {};
    const stack: string[] = [];
    for (const p of xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) || []) {
      const text = (p.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) || [])
        .map((t) => t.replace(/<[^>]+>/g, ""))
        .join("");
      for (const m of text.matchAll(/\{([^{}\n]{1,30})\}/g)) {
        const name = m[1].trim();
        if (name.startsWith("#")) {
          stack.push(name.slice(1));
          conditions.add(name.slice(1));
        } else if (name.startsWith("/")) {
          stack.pop();
        } else if (!fields.includes(name)) {
          fields.push(name);
          if (stack.length) fieldConditions[name] = stack[stack.length - 1];
        }
      }
    }
    // 직원이 서명 시 직접 입력하는 필드(퇴사일자 등) — 관리자 입력란에서 제외 대상
    const employeeFields = await scanEmployeeFillFields(template.fileUrl);
    return NextResponse.json({ fields, conditions: [...conditions], fieldConditions, employeeFields });
  } catch (e) {
    console.error("템플릿 필드 스캔 오류:", e);
    return NextResponse.json({ fields: [] });
  }
}
