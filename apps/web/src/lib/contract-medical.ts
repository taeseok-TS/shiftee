import path from "path";
import fs from "fs/promises";
import { randomBytes } from "crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requestInfo } from "@/lib/contract-events";

// 임신기 근로시간 단축 신청서 진단서 첨부(개선 제안 #242 박정인, 2026-11-05 디렉터 「추천대로」)
//  · 대상: 양식 이름에 「임신기」·「단축」이 들어간 계약(원장용·매니저·교실장용 v3 — 버전이 바뀌어도 이름으로 맞춘다)
//  · 모든 신청에 필수(근로기준법 시행령 제43조의2, 이예지 11/5). 같은 임신으로 다시 신청할 때만 근로자가 「재신청」에 체크하고 생략한다
//  · 올리기: 근로자 본인(서명 전, 웹·앱) + 본부(언제든). 지우기: 본부만
//  · 파일 보기: 본부·본인 + 재무 열람 계정(2026-11-05 디렉터 「재무 화면에서도 서류 볼 수 있게」). 원장(결재자)은 「진단서 첨부됨」 표시만 — 파일·이름을 주지 않는다(건강 정보)
//  · 앱은 외부 브라우저로 연다 — attachments/[attId]/link 가 첨부 1개에만 통하는 10분 티켓 주소를 준다(lib/upload-ticket issueAttachTicket)
//  · 칸을 새로 만들지 않는다(DDL 없음) — 계약 이벤트(ContractEvent)가 원천: ATTACH_ADDED − ATTACH_REMOVED = 지금 첨부.
//    이벤트 기록은 recordContractEvent 처럼 삼키지 않는다 — 이 기록이 곧 첨부 목록이라 실패하면 실패로 돌려준다.
//  · 파일은 uploads/private/contract-attach/<계약 id>/ — 일반 /api/uploads 는 private 를 403 으로 막는다. 여는 문은 attachments/[attId] 하나
export const MEDICAL_ADD = "ATTACH_ADDED";
export const MEDICAL_REMOVE = "ATTACH_REMOVED";
export const MEDICAL_REAPPLY = "ATTACH_SKIPPED_REAPPLY";
export const MEDICAL_MAX_FILES = 5;
export const MEDICAL_MAX_BYTES = 10 * 1024 * 1024;
export const MEDICAL_EXT = new Set([".pdf", ".jpg", ".jpeg", ".png", ".heic", ".heif"]);
export const MEDICAL_REQUIRED_MESSAGE =
  "진단서(의사 소견서)를 첨부해 주세요. 같은 임신으로 다시 신청하는 경우에는 「같은 임신으로 다시 신청합니다」에 체크해 주세요. 첨부 칸이 보이지 않으면 — 웹: 새로고침(F5), 앱: 완전히 닫았다가 다시 열어 업데이트한 뒤 서명해 주세요.";

export function isMedicalTemplateName(name: string | null | undefined): boolean {
  return !!name && name.includes("임신기") && name.includes("단축");
}

/** 이 계약이 진단서 첨부 대상인가 — 양식 이름으로 본다(양식 없는 옛 계약·외부 계약은 대상 아님) */
export async function isMedicalContract(contractId: string): Promise<boolean> {
  const c = await prisma.contract.findUnique({ where: { id: contractId }, select: { externalName: true, template: { select: { name: true } } } });
  return !!c && !c.externalName && isMedicalTemplateName(c.template?.name);
}

/** 진단서 파일을 볼 수 있는 사람 — 본부·본인·재무 열람 계정. 재무는 재무 목록(api/finance/contracts)과 같은 범위(초안·시험 문서 제외)에서
 *  반려 건도 뺀다 — 같은 반려 건의 계약서 「보기」(signed-document)도 막혀 있고, 건강 정보는 꼭 필요한 것만(11/5 검증 4) */
export async function medicalViewer(
  session: { userId: string; role: string },
  c: { userId: string; status: string; isTest: boolean },
): Promise<"admin" | "owner" | "finance" | null> {
  if (session.role === "ADMIN") return "admin";
  if (c.userId === session.userId) return "owner";
  if (c.status !== "DRAFT" && c.status !== "REJECTED" && !c.isTest) {
    const { isContractViewer } = await import("@/lib/contract-viewer");
    if (await isContractViewer(session)) return "finance";
  }
  return null;
}

export type MedicalAttachment = {
  attId: string; name: string; size: number; mime: string; uploadedAt: string; uploadedBy: string | null; byAdmin: boolean;
  key: string;   // 서버 안 파일 이름 — 응답에는 싣지 않는다(listForClient)
};

type Meta = { attId?: string; key?: string; name?: string; size?: number; mime?: string; byAdmin?: boolean };

/** 지금 첨부(올린 순) + 재신청 체크 여부 — 이벤트에서 계산 */
export async function medicalState(contractId: string, db: Pick<Prisma.TransactionClient, "contractEvent"> = prisma): Promise<{ attachments: MedicalAttachment[]; reapply: boolean }> {
  const rows = await db.contractEvent.findMany({
    where: { contractId, type: { in: [MEDICAL_ADD, MEDICAL_REMOVE, MEDICAL_REAPPLY] } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],   // 같은 시각이면 id 로 — 개수 넘침 되돌리기(route POST)가 어느 요청에서 계산해도 같은 순서를 본다
    select: { type: true, actorName: true, meta: true, createdAt: true },
  });
  const live = new Map<string, MedicalAttachment>();
  let reapply = false;
  for (const r of rows) {
    const m = (r.meta || {}) as Meta;
    if (r.type === MEDICAL_REAPPLY) { reapply = true; continue; }
    if (!m.attId) continue;
    if (r.type === MEDICAL_REMOVE) { live.delete(m.attId); continue; }
    if (!m.key) continue;
    live.set(m.attId, {
      attId: m.attId, key: m.key, name: m.name || "진단서", size: Number(m.size) || 0, mime: m.mime || "application/octet-stream",
      uploadedAt: r.createdAt.toISOString(), uploadedBy: r.actorName, byAdmin: !!m.byAdmin,
    });
  }
  return { attachments: [...live.values()], reapply };
}

export function medicalDir(contractId: string) {
  return path.join(process.cwd(), "uploads", "private", "contract-attach", contractId);
}

/** 계약을 지울 때 진단서 폴더도 지운다(이벤트는 FK cascade 로 사라져 남은 파일은 아무도 못 연다 — 건강 정보를 서버에 남기지 않는다, 11/5 검증 4) */
export async function removeMedicalDirs(contractIds: string[]): Promise<void> {
  for (const id of contractIds) {
    if (!/^[a-z0-9]+$/i.test(id)) continue;
    await fs.rm(medicalDir(id), { recursive: true, force: true }).catch((e) => console.error("[contract-medical] 폴더 삭제 실패:", id, e));
  }
}

/** 파일 저장 + ATTACH_ADDED 기록. 이름에 경로 문자가 섞여도 서버 파일 이름은 무작위로 만든다.
 *  개수 확인과 기록은 계약별 잠금(pg_advisory_xact_lock) 안에서 — 동시에 올려도 5개를 넘지 않는다(11/5 검증 1). 넘으면 파일을 지우고 null */
export async function saveMedicalFile(input: {
  contractId: string; buf: Buffer; name: string; ext: string; mime: string;
  actorId: string; actorName: string; byAdmin: boolean; request: Request;
}): Promise<MedicalAttachment | null> {
  const attId = randomBytes(9).toString("base64url");
  const key = `${Date.now()}-${attId}${input.ext}`;
  const dir = medicalDir(input.contractId);
  await fs.mkdir(dir, { recursive: true });
  const full = path.join(dir, key);
  await fs.writeFile(full, input.buf);
  const meta: Meta = { attId, key, name: input.name, size: input.buf.length, mime: input.mime, byAdmin: input.byAdmin };
  try {
    const r = requestInfo(input.request);
    const ev = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"contract-attach:" + input.contractId}))`;
      if ((await medicalState(input.contractId, tx)).attachments.length >= MEDICAL_MAX_FILES) return null;
      return tx.contractEvent.create({
        data: { contractId: input.contractId, type: MEDICAL_ADD, actorId: input.actorId, actorName: input.actorName, ip: r.ip, userAgent: r.userAgent, deviceId: r.deviceId, meta: meta as Prisma.InputJsonValue },
        select: { createdAt: true },
      });
    });
    if (!ev) { await fs.unlink(full).catch(() => {}); return null; }
    return { attId, key, name: input.name, size: input.buf.length, mime: input.mime, uploadedAt: ev.createdAt.toISOString(), uploadedBy: input.actorName, byAdmin: input.byAdmin };
  } catch (e) {
    await fs.unlink(full).catch(() => {});   // 기록이 없으면 아무도 못 여는 파일 — 남기지 않는다
    throw e;
  }
}

/** ATTACH_REMOVED 기록 + 파일 삭제 — 본부 삭제(attachments/[attId] DELETE) */
export async function removeMedicalFile(input: {
  contractId: string; att: MedicalAttachment; actorId: string; actorName: string; request: Request;
}): Promise<void> {
  const r = requestInfo(input.request);
  await prisma.contractEvent.create({
    data: {
      contractId: input.contractId, type: MEDICAL_REMOVE, actorId: input.actorId, actorName: input.actorName, ip: r.ip, userAgent: r.userAgent, deviceId: r.deviceId,
      meta: { attId: input.att.attId, name: input.att.name, size: input.att.size } as Prisma.InputJsonValue,
    },
  });
  if (path.basename(input.att.key) === input.att.key) await fs.unlink(path.join(medicalDir(input.contractId), input.att.key)).catch(() => {});
}

/** 응답용 — 서버 파일 이름(key)은 빼고 보낸다 */
export function forClient(a: MedicalAttachment) {
  const { key: _key, ...rest } = a;
  void _key;
  return rest;
}

/** 파일 앞 바이트로 실제 형식 — HEIC 는 서버 스위퍼(/opt/heic-sweep.py)가 같은 이름으로 JPEG 로 바꿔 둘 수 있어 이름을 믿지 않는다 */
export function sniffMime(h: Uint8Array, fallback: string): string {
  const ascii = (a: number, b: number) => String.fromCharCode(...h.slice(a, b));
  if (ascii(0, 5) === "%PDF-") return "application/pdf";
  if (h[0] === 0xff && h[1] === 0xd8 && h[2] === 0xff) return "image/jpeg";
  if (h[0] === 0x89 && h[1] === 0x50 && h[2] === 0x4e && h[3] === 0x47) return "image/png";
  if (ascii(4, 8) === "ftyp") return "image/heic";
  return fallback;
}
