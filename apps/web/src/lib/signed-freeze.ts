import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { prisma } from "@/lib/db";
import { embedKoreanFont } from "@/lib/pdf-korean-font";
import { firstFile, diskPath } from "@/lib/signed-doc";
import { getAppUrl } from "@/lib/app-url";
import { SIGN_CONSENT_TEXT } from "@/lib/contract-consent";
import { recordContractEvent } from "@/lib/contract-events";

/**
 * 완료본 고정(#205-5, 이예지대리 · 디렉터 9/11) — 계약이 끝난 순간의 완료본을 **PDF 한 벌로 못박는다.**
 *
 * 종전: 워드 완료본을 열 때마다 변환기(LibreOffice)로 새로 PDF 를 만들어 바이트가 매번 달랐다 → "이 파일이 그 파일"임을
 * 보일 수단(해시)이 없었다. 이제 완료 때 한 번 변환 + 증명 쪽(문서번호·서명자·본인 확인·IP·기기·검증 주소)을 붙여 저장하고
 * 그 파일의 SHA-256 을 기록한다. 공개 검증 페이지(/verify/문서번호)에서 받은 파일의 해시를 대조한다.
 *
 * ⚠ 한 번 고정하면 다시 만들지 않는다(불변). 결재 회수·재발송으로 완료가 풀리면 호출부가 네 칸을 함께 비우고,
 *   다시 완료되면 **새 문서번호**로 고정된다.
 * ⚠ GET 에서 부르지 않는다(무중단 배포 프록시가 GET 을 재시도). 서명 완료 POST 와 매시 점검에서만.
 */

// 헷갈리는 0·O·1·I·L 을 뺀 31자 — 사람이 옮겨 적어도 틀리지 않게. 10자 ≈ 49비트(추측으로 찾을 수 없다)
const ALPH = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const DOC_NO_RE = /^CT-\d{6}-[2-9A-HJKMNP-Z]{5}-[2-9A-HJKMNP-Z]{5}$/;

function newDocNo(at: Date): string {
  const ymd = new Date(at.getTime() + 9 * 3600 * 1000).toISOString().slice(2, 10).replace(/-/g, "");
  let s = "";
  for (let i = 0; i < 10; i++) s += ALPH[crypto.randomInt(ALPH.length)];
  return `CT-${ymd}-${s.slice(0, 5)}-${s.slice(5)}`;
}

const kst = (d: Date | null | undefined) =>
  d ? new Date(d.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 16).replace("T", " ") + " (KST)" : "-";

function deviceOf(ua: string | null, deviceId: string | null): string {
  const u = ua || "";
  const app = deviceId || /okhttp|Expo|CFNetwork|Dalvik/i.test(u) ? "앱" : "웹 브라우저";
  const os = /iPhone|iPad|iOS|CFNetwork|Darwin/i.test(u) ? "iOS" : /Android|okhttp|Dalvik/i.test(u) ? "Android"
    : /Windows/i.test(u) ? "Windows" : /Mac OS/i.test(u) ? "Mac" : "";
  return [app, os].filter(Boolean).join(" · ");
}

// 증명 쪽은 근로자·외부 계약자에게도 간다 — IP 는 앞 두 마디만 적는다(112.170.*.*). 전체 IP 는 관리자 감사 기록에만.
// 9/12 디렉터 확정 (나). IPv6 는 앞 두 묶음만, 알 수 없는 형식은 통째로 가린다.
export function maskIp(ip: string | null | undefined): string {
  if (!ip) return "-";
  const t = ip.trim();
  const v4 = /^(?:::ffff:)?(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/i.exec(t);
  if (v4) return `${v4[1]}.${v4[2]}.*.*`;
  // 순수 IPv6(16진수·콜론만)만 앞부분을 보인다 — 포트·괄호·점·%가 섞인 형식(1.2.3.4:5678 등)은 통째로 가린다.
  // 앞부분은 "::" 앞에서만 센다(2001::abcd 가 2001:abcd 로 적히지 않게). 33456f8 검증 F1·F2
  // 올바른 IPv6 모양(:: 축약이 있거나 8묶음)만 — "a:b" 같은 두 묶음짜리가 통째로 적히지 않게(359ea9c 검증 P1)
  if (t.includes(":") && /^[0-9a-f:]+$/i.test(t) && (t.includes("::") || t.split(":").length === 8)) {
    const head = t.split("::")[0].split(":").filter(Boolean);
    return head.length >= 2 ? `${head[0]}:${head[1]}:*` : head.length === 1 ? `${head[0]}:*` : "*";
  }
  return "*";
}

// 워드 완료본은 한 번만 PDF 로 변환한다(signed-document 라우트와 같은 변환기)
async function sourcePdf(signedUrl: string): Promise<Buffer> {
  const f = firstFile(signedUrl);
  if (!f) throw new Error("완료본 파일 경로가 없습니다");
  const buf = await fs.readFile(diskPath(f));
  if (f.toLowerCase().endsWith(".pdf")) return buf;
  const fd = new FormData();
  fd.append("files", new Blob([new Uint8Array(buf)]), "document.docx");
  const g = await fetch(`${process.env.GOTENBERG_URL || "http://gotenberg:3000"}/forms/libreoffice/convert`, {
    method: "POST", body: fd, signal: AbortSignal.timeout(90_000),
  });
  if (!g.ok) throw new Error(`PDF 변환 실패(${g.status})`);
  return Buffer.from(await g.arrayBuffer());
}

// 증명 쪽 — 글꼴에 없는 글자(이모지 등)는 ? 로 바꾼다. 한 글자 때문에 고정 전체가 실패하지 않게
function writer(doc: PDFDocument, font: PDFFont) {
  const W = 595.28, H = 841.89, M = 50, maxW = W - 2 * M;
  const have = new Set(font.getCharacterSet());
  const clean = (t: string) => Array.from(t).map((ch) => (have.has(ch.codePointAt(0)!) ? ch : "?")).join("");
  let page: PDFPage = doc.addPage([W, H]);
  let y = H - 60;
  const room = (need: number) => { if (y - need < 50) { page = doc.addPage([W, H]); y = H - 60; } };
  const wrap = (t: string, size: number) => {
    const out: string[] = [];
    let line = "";
    for (const ch of Array.from(clean(t))) {
      const next = line + ch;
      if (line && font.widthOfTextAtSize(next, size) > maxW) { out.push(line); line = ch; } else line = next;
    }
    if (line) out.push(line);
    return out;
  };
  return {
    text(t: string, size = 10, color = rgb(0.15, 0.15, 0.15), indent = 0) {
      for (const ln of wrap(t, size)) {
        room(size + 6);
        page.drawText(ln, { x: M + indent, y, size, font, color });
        y -= size + 6;
      }
    },
    gap(h = 8) { y -= h; },
    rule() { room(14); page.drawLine({ start: { x: M, y: y + 4 }, end: { x: W - M, y: y + 4 }, thickness: 0.6, color: rgb(0.8, 0.8, 0.8) }); y -= 12; },
  };
}

export async function freezeSignedPdf(contractId: string): Promise<{ docNo: string; sha256: string } | null> {
  const c = await prisma.contract.findUnique({
    where: { id: contractId },
    include: { approvalLine: { include: { steps: { orderBy: { order: "asc" }, include: { approver: { select: { name: true } } } } } } },
  });
  if (!c || c.status !== "SIGNED" || !c.signedUrl) return null;
  if (c.signedPdfUrl && c.signedSha256 && c.docNo) return { docNo: c.docNo, sha256: c.signedSha256 }; // 이미 고정 — 불변

  const all = await prisma.contractEvent.findMany({
    where: { contractId, type: { in: ["SIGNED", "VERIFY_OK", "CONSENT", "SENT", "RESEND", "RESET"] } },
    orderBy: { createdAt: "asc" },
  });
  // 이번 회차(마지막 발송·재발송·결재 초기화 이후) 기록만 본다 — 옛 회차의 같은 단계 번호 기록(다른 사람의 동의·IP)이
  // 섞이지 않게(8330d85 검증 5). 사내 단계는 그 단계 결재자 본인 기록만, 외부 단계는 계정이 없어 단계 번호로.
  const roundStart = [...all].reverse().find((e) => e.type === "SENT" || e.type === "RESEND" || e.type === "RESET")?.createdAt;
  // 1분 여유: 경계 기록(RESEND·SENT)은 새 결재선을 만든 **뒤**에 남아, 그 틈에 들어온 새 회차 서명이 경계보다 앞설 수 있다
  // (6f53400 재검증 N2). 사내 단계는 결재자 본인 기록만 보고 외부 단계는 제출 시점 확인 기록이 있어 옛 회차가 섞이지 않는다.
  const events = all.filter((e) => !roundStart || e.createdAt.getTime() >= roundStart.getTime() - 60_000);
  const lastOf = (type: string, st: { order: number; approverId: string | null }) =>
    [...events].reverse().find((e) => e.type === type && e.stepOrder === st.order && (!st.approverId || e.actorId === st.approverId));

  const src = await sourcePdf(c.signedUrl);
  const doc = await PDFDocument.load(src, { ignoreEncryption: true });
  const font = await embedKoreanFont(doc); // 통째로 — 부분 넣기는 운영 글꼴에서 글자가 빠진다(lib/pdf-korean-font.ts)
  const now = new Date();
  const docNo = newDocNo(c.signedAt || now);
  const verifyUrl = `${getAppUrl()}/verify/${docNo}`;

  const w = writer(doc, font);
  const dark = rgb(0.05, 0.05, 0.05), gray = rgb(0.4, 0.4, 0.4);
  w.text("전자서명 완료 증명서", 18, dark);
  w.gap(4);
  w.text(`문서번호  ${docNo}`, 12, dark);
  w.text(`계약명  ${c.title}`, 11);
  w.text(`계약 완료  ${kst(c.signedAt)}`, 10);
  w.text(`완료본 고정  ${kst(now)}`, 10);
  w.gap(4);
  w.rule();
  w.text("서명 내역", 12, dark);
  w.gap(2);
  let anyConsent = false; // 동의 문구 꼬리말은 동의 줄이 실제로 찍힌 서명자가 있을 때만(1분 여유로 옛 회차 동의가 끼지 않게)
  for (const st of c.approvalLine?.steps || []) {
    if (!st.signatureUrl) continue;
    const external = !st.approverId;
    const employee = external ? false : st.approverId === c.userId && !c.externalName;
    const role = external ? "외부 계약자" : employee ? "근로자 본인" : `${st.order}단계 결재자`;
    const name = st.approver?.name || st.externalName || c.externalName || "외부 서명자";
    const signed = lastOf("SIGNED", st);
    const consent = lastOf("CONSENT", st);
    const method = external
      ? (lastOf("VERIFY_OK", st) ? "서명 링크 + 연락처 뒷자리 확인" : "서명 링크")
      : employee
        ? (signed ? "로그인 + 비밀번호 재확인" : "로그인 계정")
        : "로그인 계정";
    w.text(`${st.order}. ${role}  ${name}   서명 ${kst(st.decidedAt)}`, 10, dark);
    w.text(`본인 확인: ${method}`, 9, gray, 14);
    w.text(signed
      ? `접속: IP ${maskIp(signed.ip)} · ${deviceOf(signed.userAgent, signed.deviceId) || "-"}`
      : "접속: 기록 없음(감사 기록 도입 전 서명)", 9, gray, 14);
    if (consent) {
      anyConsent = true;
      const read = (consent.meta as { readToEnd?: boolean } | null)?.readToEnd;
      w.text(`전자서명 동의: 예${read === true ? " · 문서 끝까지 스크롤(화면 기준)" : ""}`, 9, gray, 14);
    }
    w.gap(4);
  }
  if (anyConsent) {
    w.rule();
    w.text(`동의 문구: "${SIGN_CONSENT_TEXT}"`, 9, gray);
  }
  w.rule();
  w.text("진위 확인", 12, dark);
  w.text("아래 주소에서 이 PDF 파일을 올리면, 발급 때 기록한 SHA-256 값과 같은지 브라우저 안에서 대조합니다.", 9, gray);
  w.text("같으면 발급 원본이고, 한 글자라도 바뀐 파일이면 다르게 나옵니다.", 9, gray);
  w.text(verifyUrl, 10, rgb(0.1, 0.2, 0.6));
  w.gap(6);
  w.text("큐브티 전자계약", 9, gray);

  const bytes = Buffer.from(await doc.save());
  const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
  const filename = `${Date.now()}-${crypto.randomBytes(5).toString("hex")}-final.pdf`;
  const dir = path.join(process.cwd(), "uploads", "contracts");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, filename), bytes);
  const url = `/api/uploads/contracts/${filename}`;

  // 동시에 두 번 고정되지 않게, 그리고 그 사이 회수·재완료됐으면 쓰지 않게 — 읽은 완료본 그대로이고 아직 비어 있을 때만
  let r: { count: number };
  try {
    r = await prisma.contract.updateMany({
      where: { id: contractId, status: "SIGNED", signedUrl: c.signedUrl, signedPdfUrl: null },
      data: { docNo, signedPdfUrl: url, signedSha256: sha256, signedPdfAt: now },
    });
  } catch (e) {
    await fs.unlink(path.join(dir, filename)).catch(() => {}); // 기록 실패(문서번호 충돌 등) — 방금 만든 사본을 남기지 않는다
    throw e;
  }
  if (r.count === 0) {
    await fs.unlink(path.join(dir, filename)).catch(() => {}); // 방금 만든 쓰지 않을 사본
    const cur = await prisma.contract.findUnique({ where: { id: contractId }, select: { docNo: true, signedSha256: true } });
    return cur?.docNo && cur.signedSha256 ? { docNo: cur.docNo, sha256: cur.signedSha256 } : null;
  }
  await recordContractEvent({ contractId, type: "FROZEN", actorName: "시스템", meta: { docNo, sha256 } });
  // 제3자 시각 도장(TSA) — 기다리지 않는다(외부 서비스가 느려도 서명 응답이 늦지 않게). 실패·유실분은 매시 점검이 다시 받는다.
  void import("@/lib/tsa").then(({ stampFrozen }) => stampFrozen(contractId, sha256)).catch(() => {});
  return { docNo, sha256 };
}
