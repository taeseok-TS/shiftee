import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import PizZip from "pizzip";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { recordContractEvent } from "@/lib/contract-events";
import { newDocNo } from "@/lib/signed-freeze";

// ─── 모두싸인 체결본 가져오기(2026-10-08 QA76 #4) ─────────────────────────
// 본부가 모두싸인 문서함에서 내려받은 체결본 PDF(ZIP)와 목록표(엑셀)를 큐브티 직원별 문서함에 넣는다.
//  · 목록표 행 ↔ 파일: 파일명 열이 있으면 그 이름, 없으면 문서 ID 가 든 파일명, 없으면 문서명과 같은 파일명(확장자·공백·괄호 무시)
//  · 직원 매칭: 사번 → 이메일 → 이름(미삭제 중 한 명일 때만, 퇴사자 포함 — 본부 답변 #38 「퇴사자 체결 문서는 본부 문서함 보관」).
//    사번·이메일로 찾았는데 파일 이름과 다르면 건너뛴다
//  · 문서 종류: 종류 열이 있으면 그것, 없으면 문서명으로 짐작(근로계약 → EMPLOYMENT, 단시간 → PART_TIME, 비밀유지 → CONFIDENTIAL, 그 밖은 OTHER)
//  · 중복: 같은 importRef(문서 ID·파일명)가 이미 있거나, 같은 직원·같은 문서명·같은 체결일이 있으면 건너뛴다
//  · 적용: PDF 를 uploads/contracts 에 **평면**으로 저장(하위 폴더면 lib/contract-access 의 정확 매칭이 깨진다), 계약은 SIGNED·
//    완료본(signedUrl=signedPdfUrl=그 PDF)·SHA-256·문서번호·체결일, 결재선 없음, 이벤트 IMPORTED. 인증서 PDF 가 짝지어지면 certificateUrl
//    자동 고정(signed-doc-heal)은 signedUrl·signedPdfUrl 이 있어 건드리지 않고, 시각 인증(TSA)은 다른 완료본과 같이 붙는다
//  · 되돌리기: 배치의 계약을 지우고(FK cascade) 그 배치의 파일을 지운다
export type ContractImportRow = { title?: string | null; name?: string | null; empNo?: string | number | null; email?: string | null; signedAt?: string | null; ref?: string | null; type?: string | null; file?: string | null };
export type ContractImportStatus = "ok" | "applied" | "user_not_found" | "user_ambiguous" | "user_mismatch" | "file_not_found" | "file_ambiguous" | "invalid" | "duplicate";
export type ContractImportResult = {
  i: number; title: string; name: string; matched: { userId: string; name: string; branch: string | null; resigned: boolean } | null;
  type: string; signedAt: string; ref: string; file: string | null; certFile: string | null;
  status: ContractImportStatus; message: string;
};
const TYPES = ["EMPLOYMENT", "PART_TIME", "CONFIDENTIAL", "OTHER"] as const;
type CType = (typeof TYPES)[number];
const str = (v: unknown) => (v == null ? "" : String(v).trim());
const norm = (s: string) => s.replace(/\.(pdf|PDF)$/, "").replace(/[\s()_\-·.\[\]]/g, "").toLowerCase();
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const CERT_RE = /감사\s*추적|인증서|certificate|audit[\s_-]*trail/i;   // 「감사서약서」「김감사」 같은 본 문서·사람 이름에 걸리지 않게 복합어만
const CERT_STRIP = /감사\s*추적|인증서|certificate|audit[\s_-]*trail/gi;
const MAX_ENTRY = 60 * 1024 * 1024;   // ZIP 항목 하나 풀린 크기 상한 — 압축 폭탄·메모리 보호

const toYmd = (v: unknown): string | null => {
  const s = str(v);
  const m = /^(\d{4})[.\-/년 ]\s*(\d{1,2})[.\-/월 ]\s*(\d{1,2})/.exec(s);
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d ? dt.toISOString().slice(0, 10) : null;
};
export function guessContractType(title: string, hint?: string | null): CType {
  const h = str(hint).toUpperCase();
  if ((TYPES as readonly string[]).includes(h)) return h as CType;
  const t = `${title} ${hint ?? ""}`;
  if (/단시간|시간제|파트/.test(t)) return "PART_TIME";
  if (/근로계약|고용계약|연봉계약|employment/i.test(t)) return "EMPLOYMENT";
  if (/비밀유지|기밀|nda|confidential/i.test(t)) return "CONFIDENTIAL";
  return "OTHER";
}

/** 목록표 행과 파일 이름을 대조해 적용 가능 여부를 판정한다(쓰지 않는다). fileNames 는 ZIP 안 항목 이름 */
export async function previewContractImport(rowsIn: unknown[], fileNames: string[]): Promise<ContractImportResult[]> {
  const rows: ContractImportRow[] = rowsIn.map((r) => (isObj(r) ? (r as ContractImportRow) : {}));
  const pdfs = fileNames.filter((f) => /\.pdf$/i.test(f) && !f.startsWith("__MACOSX"));
  const docs = pdfs.filter((f) => !CERT_RE.test(path.basename(f)));
  const certs = pdfs.filter((f) => CERT_RE.test(path.basename(f)));
  const users = await prisma.user.findMany({ where: { deletedAt: null }, select: { id: true, name: true, email: true, empNo: true, branch: true, resignDate: true } });
  const byEmpNo = new Map(users.filter((u) => u.empNo != null).map((u) => [u.empNo as number, u]));
  const byEmail = new Map(users.map((u) => [u.email.toLowerCase(), u]));
  const byName = new Map<string, typeof users>();
  for (const u of users) byName.set(norm(u.name), [...(byName.get(norm(u.name)) ?? []), u]);
  const today = new Date();

  // 여러 파일이 걸리면 서명자 이름이 든 파일로 한 번 더 좁힌다(모두싸인 체결본은 「문서명_참여자」 꼴이 많다)
  const pick = (hits: string[], name: string): { file: string | null; many: boolean } => {
    if (hits.length === 1) return { file: hits[0], many: false };
    if (hits.length === 0) return { file: null, many: false };
    const nn = norm(name);
    const byName = nn ? hits.filter((f) => norm(path.basename(f)).includes(nn)) : [];
    return byName.length === 1 ? { file: byName[0], many: false } : { file: null, many: true };
  };
  const findFile = (r: ContractImportRow, title: string, ref: string, name: string): { file: string | null; many: boolean } => {
    const explicit = str(r.file);
    if (explicit) {
      const hit = docs.find((f) => path.basename(f) === explicit || norm(path.basename(f)) === norm(explicit));
      return { file: hit ?? null, many: false };
    }
    if (ref.length >= 6) { const p = pick(docs.filter((f) => path.basename(f).includes(ref)), name); if (p.file || p.many) return p; }   // 짧은 ID 는 날짜·번호에 오매칭
    const nt = norm(title);
    if (nt) { const p = pick(docs.filter((f) => norm(path.basename(f)) === nt || norm(path.basename(f)).startsWith(nt)), name); if (p.file || p.many) return p; }
    return { file: null, many: false };
  };
  // 인증서는 **정확히** 짝지어질 때만 — 문서 ID 가 들어 있거나, 인증서 이름에서 「인증서·감사추적」을 뗀 나머지가 본 문서 이름과 같을 때(빈 문자열이면 짝짓지 않는다)
  const findCert = (ref: string, file: string | null) => {
    if (ref.length >= 6) { const c = certs.filter((f) => path.basename(f).includes(ref)); if (c.length === 1) return c[0]; }
    if (file) { const stem = norm(path.basename(file)); const c = certs.filter((f) => { const s = norm(path.basename(f).replace(CERT_STRIP, "")); return !!s && s === stem; }); if (c.length === 1) return c[0]; }
    return null;
  };

  const out: ContractImportResult[] = rows.map((r, i) => {
    const title = str(r.title), name = str(r.name), ref = str(r.ref);
    const base: ContractImportResult = { i, title, name, matched: null, type: guessContractType(title, r.type), signedAt: toYmd(r.signedAt) ?? str(r.signedAt), ref, file: null, certFile: null, status: "ok", message: "" };
    if (!title) return { ...base, status: "invalid", message: "문서명이 비어 있음" };
    const signedAt = toYmd(r.signedAt);
    if (!signedAt) return { ...base, status: "invalid", message: "체결일 형식(예: 2026-05-01)이 잘못됨" };
    const { file, many } = findFile(r, title, ref, name);
    if (many) return { ...base, signedAt, status: "file_ambiguous", message: "맞는 파일이 여러 개 — 파일명 열을 넣어 주세요" };
    if (!file) return { ...base, signedAt, status: "file_not_found", message: "ZIP 안에 맞는 PDF 가 없음(문서 ID·문서명으로 찾음)" };
    const withFile = { ...base, signedAt, file, certFile: findCert(ref, file) };
    // 직원
    let user: (typeof users)[number] | undefined; let how = "";
    const empNoText = str(r.empNo); const empNo = /^\d+$/.test(empNoText) ? Number(empNoText) : 0;
    if (empNo > 0) { user = byEmpNo.get(empNo); how = "사번"; }
    if (!user && r.email) { user = byEmail.get(str(r.email).toLowerCase()); how = "이메일"; }
    if (user && name && norm(user.name) !== norm(name)) return { ...withFile, status: "user_mismatch", message: `${how}으로 찾은 직원(${user.name})과 목록표 이름(${name})이 다름` };
    if (!user && name) { const c = byName.get(norm(name)) ?? []; if (c.length > 1) return { ...withFile, status: "user_ambiguous", message: `같은 이름 ${c.length}명 — 사번이나 이메일 열을 넣어 주세요` }; user = c[0]; }
    if (!user) return { ...withFile, status: "user_not_found", message: "직원을 찾지 못함(사번·이메일·이름)" };
    return { ...withFile, matched: { userId: user.id, name: user.name, branch: user.branch, resigned: !!user.resignDate && user.resignDate < today }, status: "ok", message: "" };
  });

  // 중복 — 같은 importRef, 같은 직원·문서명·체결일, 파일 안 같은 파일 두 번
  const ok = out.filter((r) => r.status === "ok");
  if (ok.length) {
    const refs = ok.map((r) => r.ref || path.basename(r.file!));
    const existing = await prisma.contract.findMany({
      where: { OR: [{ importRef: { in: refs } }, { userId: { in: [...new Set(ok.map((r) => r.matched!.userId))] }, status: "SIGNED", title: { in: [...new Set(ok.map((r) => r.title))] } }] },
      select: { userId: true, title: true, importRef: true, signedAt: true },
    });
    const seen = new Set<string>();
    for (const r of ok) {
      const myRef = r.ref || path.basename(r.file!);
      if (existing.some((x) => x.importRef === myRef)) { r.status = "duplicate"; r.message = "이미 가져온 문서(같은 문서 ID·파일명)"; continue; }
      // 기존 계약의 signedAt 은 실제 시각(UTC) — KST 날짜로 바꿔 비교(이관본은 UTC 자정 = KST 09:00 이라 같은 날)
      if (existing.some((x) => x.userId === r.matched!.userId && x.title === r.title && x.signedAt && new Date(x.signedAt.getTime() + 9 * 3600000).toISOString().slice(0, 10) === r.signedAt)) { r.status = "duplicate"; r.message = "같은 직원·문서명·체결일의 완료 계약이 이미 있음"; continue; }
      if (seen.has(r.file!)) { r.status = "duplicate"; r.message = "목록표 안에서 같은 파일이 또 쓰임"; continue; }
      seen.add(r.file!);
    }
  }
  return out;
}

export type ContractImportOutcome = { batch: string | null; applied: number; skipped: number; failedAt: number | null; error: string | null; results: ContractImportResult[] };

/** 적용 — ZIP 에서 PDF 를 꺼내 저장하고 완료 계약으로 넣는다 */
export async function applyContractImport(rowsIn: unknown[], zips: Buffer[], actor: { userId: string; name: string }): Promise<ContractImportOutcome> {
  const archives = zips.map((b) => new PizZip(b));
  const entries = new Map<string, PizZip.ZipObject>();
  for (const z of archives) for (const [n, f] of Object.entries(z.files)) if (!f.dir) entries.set(n, f);
  const preview = await previewContractImport(rowsIn, [...entries.keys()]);
  const ok = preview.filter((r) => r.status === "ok");
  if (!ok.length) return { batch: null, applied: 0, skipped: preview.length, failedAt: null, error: null, results: preview };
  const batch = `cimp_${new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10).replace(/-/g, "")}_${Math.random().toString(36).slice(2, 8)}`;
  const dir = path.join(process.cwd(), "uploads", "contracts");
  await fs.mkdir(dir, { recursive: true });
  const save = async (entryName: string, n: number, kind: "doc" | "cert") => {
    const entry = entries.get(entryName)!;
    const declared = (entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize;
    if (declared != null && declared > MAX_ENTRY) throw new Error(`파일이 너무 큼(${Math.round(declared / 1048576)}MB): ${entryName}`);
    const bytes = Buffer.from(entry.asUint8Array());
    if (bytes.length > MAX_ENTRY) throw new Error(`파일이 너무 큼: ${entryName}`);
    if (bytes.length < 100 || bytes.subarray(0, 4).toString() !== "%PDF") throw new Error(`PDF 가 아님: ${entryName}`);
    const filename = `${batch}_${String(n).padStart(4, "0")}_${kind}.pdf`;   // 배치 이름으로 시작 — 되돌리기 때 이 접두어로 지운다
    await fs.writeFile(path.join(dir, filename), bytes);
    return { url: `/api/uploads/contracts/${filename}`, sha256: crypto.createHash("sha256").update(bytes).digest("hex") };
  };
  let applied = 0, failedAt: number | null = null, error: string | null = null;
  for (let n = 0; n < ok.length; n++) {
    const r = ok[n];
    try {
      const doc = await save(r.file!, n + 1, "doc");
      const cert = r.certFile ? await save(r.certFile, n + 1, "cert") : null;
      const signedAt = new Date(`${r.signedAt}T00:00:00Z`);
      const now = new Date();
      const created = await prisma.contract.create({
        data: {
          userId: r.matched!.userId, createdBy: actor.userId, title: r.title, type: r.type as CType, status: "SIGNED",
          fileUrl: JSON.stringify(cert ? [doc.url, cert.url] : [doc.url]), signedUrl: doc.url, signedPdfUrl: doc.url, signedSha256: doc.sha256, signedPdfAt: now, docNo: newDocNo(signedAt),
          signedAt, employeeSignedAt: signedAt, importBatch: batch, importRef: r.ref || path.basename(r.file!), certificateUrl: cert?.url ?? null,
        },
      });
      await recordContractEvent({ contractId: created.id, type: "IMPORTED", actorId: actor.userId, actorName: actor.name, meta: { from: "모두싸인", ref: r.ref || null, file: path.basename(r.file!), cert: r.certFile ? path.basename(r.certFile) : null, signedAt: r.signedAt } });
      r.status = "applied"; r.message = ""; applied++;
    } catch (e) {
      failedAt = r.i; error = e instanceof Error ? e.message : String(e);
      console.error("[contract-import] 적용 실패:", r.i, e);
      break;
    }
  }
  await logAudit({ actorId: actor.userId, actorName: actor.name, action: "CONTRACT_IMPORT", targetType: "Contract", targetId: batch,
    detail: `모두싸인 체결본 가져오기 ${batch}: ${applied}건 적용, ${preview.length - applied}행 건너뜀${failedAt != null ? `, ${failedAt + 2}행에서 실패해 중단(${error})` : ""}` });
  return { batch: applied ? batch : null, applied, skipped: preview.length - applied, failedAt, error, results: preview };
}

/** 되돌리기 — 배치의 계약(FK cascade)과 파일을 지운다 */
export async function rollbackContractImport(batch: string, actor: { userId: string; name: string }) {
  const r = await prisma.contract.deleteMany({ where: { importBatch: batch } });
  const dir = path.join(process.cwd(), "uploads", "contracts");
  let files = 0;
  for (const f of await fs.readdir(dir).catch(() => [] as string[])) if (f.startsWith(`${batch}_`)) { await fs.unlink(path.join(dir, f)).catch(() => {}); files++; }
  await logAudit({ actorId: actor.userId, actorName: actor.name, action: "CONTRACT_IMPORT_ROLLBACK", targetType: "Contract", targetId: batch, detail: `모두싸인 체결본 가져오기 되돌리기 ${batch}: 계약 ${r.count}건·파일 ${files}개 삭제` });
  return { removed: r.count, files };
}

export async function listContractImportBatches() {
  const g = await prisma.contract.groupBy({ by: ["importBatch"], where: { importBatch: { not: null } }, _count: { _all: true }, _min: { createdAt: true } });
  return g.map((x) => ({ batch: x.importBatch!, count: x._count._all, createdAt: x._min.createdAt?.toISOString() ?? null })).sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
}
