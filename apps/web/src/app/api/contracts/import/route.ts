import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { previewContractImport, applyContractImport, rollbackContractImport, listContractImportBatches } from "@/lib/contract-import";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_ZIP = 100 * 1024 * 1024;   // ZIP 하나 100MB — next.config proxyClientMaxBodySize(110mb) 안쪽. 더 크면 나눠 올린다(메모리에 올려 읽는다)

// 모두싸인 체결본 가져오기(2026-10-08 QA76 #4) — 본부만.
//  GET: 묶음 목록 / POST JSON { rows, fileNames }: 미리보기 / POST multipart rows(JSON)+zip(여러 개): 적용 / DELETE ?batch=: 되돌리기
const admin = async () => { const s = await getSession(); if (!s) return { err: NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 }) }; if (s.role !== "ADMIN") return { err: NextResponse.json({ error: "본부만 할 수 있습니다." }, { status: 403 }) }; return { s }; };

export async function GET() {
  const { s, err } = await admin(); if (!s) return err;
  return NextResponse.json({ batches: await listContractImportBatches() });
}

export async function POST(request: NextRequest) {
  const { s, err } = await admin(); if (!s) return err;
  try {
    if ((request.headers.get("content-type") || "").includes("multipart/form-data")) {
      const fd = await request.formData();
      let rows: unknown = null;
      try { rows = JSON.parse(String(fd.get("rows") || "null")); } catch { rows = null; }
      if (!Array.isArray(rows) || !rows.length) return NextResponse.json({ error: "가져올 행이 없습니다." }, { status: 400 });
      if (rows.length > 2000) return NextResponse.json({ error: "한 번에 2,000행까지 가져올 수 있습니다." }, { status: 400 });
      const zips = fd.getAll("zip").filter((f): f is File => f instanceof File);
      if (!zips.length) return NextResponse.json({ error: "ZIP 파일을 올려 주세요." }, { status: 400 });
      for (const z of zips) if (z.size > MAX_ZIP) return NextResponse.json({ error: `ZIP 은 하나에 100MB 까지입니다(${z.name}). 나눠 올려 주세요.` }, { status: 400 });
      if (zips.reduce((a, z) => a + z.size, 0) > MAX_ZIP) return NextResponse.json({ error: "한 번에 올리는 ZIP 합계는 100MB 까지입니다. 나눠 올려 주세요." }, { status: 400 });
      const buffers = await Promise.all(zips.map(async (z) => Buffer.from(await z.arrayBuffer())));
      const r = await applyContractImport(rows, buffers, { userId: s.userId, name: s.name });
      return NextResponse.json({ success: true, ...r });
    }
    const body: unknown = await request.json().catch(() => null);
    const b = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    const rows = Array.isArray(b.rows) ? (b.rows as unknown[]) : [];
    const fileNames = Array.isArray(b.fileNames) ? (b.fileNames as unknown[]).filter((x): x is string => typeof x === "string") : [];
    if (!rows.length) return NextResponse.json({ error: "가져올 행이 없습니다." }, { status: 400 });
    if (rows.length > 2000) return NextResponse.json({ error: "한 번에 2,000행까지 가져올 수 있습니다." }, { status: 400 });
    return NextResponse.json({ preview: true, results: await previewContractImport(rows, fileNames) });
  } catch (e) {
    console.error("[contract-import] 오류:", e);
    return NextResponse.json({ error: "처리하지 못했습니다. 파일을 확인해 주세요." }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const { s, err } = await admin(); if (!s) return err;
  const batch = new URL(request.url).searchParams.get("batch") || "";
  if (!/^cimp_\d{8}_[a-z0-9]{6}$/.test(batch)) return NextResponse.json({ error: "묶음을 골라 주세요." }, { status: 400 });
  return NextResponse.json({ success: true, ...(await rollbackContractImport(batch, { userId: s.userId, name: s.name })) });
}
