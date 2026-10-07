import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs/promises";
import PizZip from "pizzip";
import * as XLSX from "xlsx";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

// 계약 일괄 내려받기(2026-10-07 QA #46) — 관리자만. 목록에서 고른 계약(최대 200건)을
//  · kind=zip  : 완료본 PDF 묶음(고정 완료본 → 저장 완료본 순). 완료본이 없는 건은 「목록.txt」에 이유와 함께 적는다
//  · kind=xlsx : 입력값 엑셀(제목·직원·지점·상태·작성일·완료일·기한·양식 버전·문서번호 + 입력 칸 전부)
// 누가 무엇을 받았는지 감사 로그에 남긴다.
const STATUS: Record<string, string> = { DRAFT: "초안", SENT: "서명 대기", APPROVED: "결재 중", SIGNED: "완료", REJECTED: "반려", EXPIRED: "만료" };
const kst = (d: Date | null | undefined) => (d ? new Date(d.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 16).replace("T", " ") : "");

function diskPath(url: string): string | null {
  const rel = url.replace(/^\/api\/uploads\//, "");
  if (!rel || rel.includes("..")) return null;
  return path.join(process.cwd(), "uploads", rel);
}
const firstFile = (raw: string | null): string | null => {
  if (!raw) return null;
  try { const a = JSON.parse(raw); return Array.isArray(a) ? (a[0] ?? null) : raw; } catch { return raw; }
};
const safeName = (s: string) => s.replace(/[\\/:*?"<>|\r\n]+/g, "_").slice(0, 80);

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role !== "ADMIN") return NextResponse.json({ error: "관리자만 내려받을 수 있습니다." }, { status: 403 });
  const body = (await request.json().catch(() => ({}))) as { ids?: unknown; kind?: unknown };
  const ids = Array.isArray(body.ids) ? [...new Set(body.ids.filter((x): x is string => typeof x === "string"))].slice(0, 200) : [];
  if (!ids.length) return NextResponse.json({ error: "계약을 골라 주세요." }, { status: 400 });
  const kind = body.kind === "zip" ? "zip" : body.kind === "xlsx" ? "xlsx" : null;
  if (!kind) return NextResponse.json({ error: "받을 형식을 골라 주세요." }, { status: 400 });

  const rows = await prisma.contract.findMany({
    where: { id: { in: ids } },
    select: {
      id: true, title: true, status: true, createdAt: true, signedAt: true, signDeadline: true, templateVersion: true, docNo: true,
      signedPdfUrl: true, signedUrl: true, extraFields: true, externalName: true,
      user: { select: { name: true, branch: true, empNo: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  const who = (r: (typeof rows)[number]) => (r.externalName ? `[외부] ${r.externalName}` : r.user.name);
  const stamp = kst(new Date()).slice(0, 10);

  if (kind === "xlsx") {
    const keys = [...new Set(rows.flatMap((r) => Object.keys((r.extraFields as Record<string, unknown>) || {})))].sort();
    const data = rows.map((r) => {
      const ex = (r.extraFields as Record<string, unknown>) || {};
      return {
        제목: r.title, 직원: who(r), 사번: r.externalName || r.user.empNo == null ? "" : String(r.user.empNo).padStart(5, "0"),
        지점: r.externalName ? "" : r.user.branch ?? "", 상태: STATUS[r.status] ?? r.status,
        작성일: kst(r.createdAt), 완료일: kst(r.signedAt), 서명기한: kst(r.signDeadline).slice(0, 10),
        양식버전: r.templateVersion ?? "", 문서번호: r.docNo ?? "",
        ...Object.fromEntries(keys.map((k) => [k, typeof ex[k] === "string" ? (ex[k] as string) : ex[k] == null ? "" : String(ex[k])])),
      };
    });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), "계약");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
    await logAudit({ actorId: session.userId, actorName: session.name, action: "CONTRACT_EXPORT", targetType: "Contract", detail: `입력값 엑셀 ${rows.length}건` });
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`계약_입력값_${stamp}.xlsx`)}`,
      },
    });
  }

  // ZIP — 완료본만(서명·직인·증명서가 든 PDF)
  const zip = new PizZip();
  const notes: string[] = [];
  const used = new Set<string>();
  let n = 0;
  for (const r of rows) {
    if (r.status !== "SIGNED") { notes.push(`${r.title} (${who(r)}) — ${STATUS[r.status] ?? r.status}: 완료 전이라 넣지 않음`); continue; }
    const src = r.signedPdfUrl || (firstFile(r.signedUrl)?.toLowerCase().endsWith(".pdf") ? firstFile(r.signedUrl) : null);
    const file = src ? diskPath(src) : null;
    if (!file) { notes.push(`${r.title} (${who(r)}) — 저장된 완료본 PDF 가 없음 — 목록에서 하나씩 내려받아 주세요`); continue; }
    try {
      const bytes = await fs.readFile(file);
      let name = safeName(`${who(r)}_${r.title}${r.docNo ? `_${r.docNo}` : ""}`) + ".pdf";
      for (let i = 2; used.has(name); i++) name = safeName(`${who(r)}_${r.title}_${i}`) + ".pdf";
      used.add(name);
      zip.file(name, bytes);
      n++;
    } catch {
      notes.push(`${r.title} (${who(r)}) — 파일을 읽지 못함`);
    }
  }
  zip.file("목록.txt", [`받은 시각 ${kst(new Date())} (KST)`, `완료본 ${n}건`, ...(notes.length ? ["", "넣지 않은 계약:", ...notes] : [])].join("\r\n"));
  const out = zip.generate({ type: "nodebuffer", compression: "DEFLATE" });
  await logAudit({ actorId: session.userId, actorName: session.name, action: "CONTRACT_EXPORT", targetType: "Contract", detail: `완료본 ZIP ${n}건(고른 ${rows.length}건)` });
  return new NextResponse(new Uint8Array(out), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`계약_완료본_${stamp}.zip`)}`,
    },
  });
}
