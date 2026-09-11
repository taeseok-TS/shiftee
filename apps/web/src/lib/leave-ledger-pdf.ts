import { PDFDocument, rgb, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import fs from "fs/promises";
import type { Ledger } from "@/lib/leave-ledger";

// 한글 PDF 글꼴 — 계약서(lib/signed-doc.ts)와 같은 경로 규칙. 운영 컨테이너는 FONT_PATH 로 지정한다.
const FONT_PATH = process.env.FONT_PATH || "C:/Windows/Fonts/malgun.ttf";

const TYPE_LABEL: Record<string, string> = {
  ANNUAL: "연차", HALF_AM: "오전반차", HALF_PM: "오후반차", QUARTER_AM: "오전반반차", QUARTER_PM: "오후반반차",
  SICK: "병가", PERSONAL: "개인휴가", SPECIAL: "특별휴가", COMPENSATORY: "대체휴무", COMPENSATORY_HALF: "대체휴무반차",
  CIVIL_DEFENSE: "민방위", RESERVE_FORCES: "예비군훈련", MATERNITY: "출산휴가", BEREAVEMENT: "상주휴가",
  FAMILY_EVENT: "경조사", FAMILY_MARRIAGE: "결혼", FAMILY_BIRTH: "출산", FAMILY_BEREAVEMENT: "사망(조사)",
};
const STATUS_LABEL: Record<string, string> = {
  PENDING: "대기", APPROVED: "승인", REJECTED: "반려", CANCELLED: "취소", WAITING: "대기 전",
};
const ROLE_LABEL: Record<string, string> = { ADMIN: "관리자", MANAGER: "원장" };

/** 실제 시각 → "YYYY-MM-DD HH:mm"(KST) */
const kst = (s: string | null) =>
  s ? new Date(new Date(s).getTime() + 9 * 3600 * 1000).toISOString().slice(0, 16).replace("T", " ") : "-";

/**
 * 연차 대장 PDF — A4 세로, 글자만(표 선 없이) 줄 단위로 흘린다. 결재자 이름·시각이 박힌다.
 * ⚠ 한글 글꼴을 못 읽으면 **던진다**(영문으로 낮추면 이름·사유가 전부 빠진 대장이 나가 분쟁 자료가 못 된다).
 *   글자 하나를 못 그리면 pdf-lib 이 던지므로 줄 단위로 감싼다(계약서 안내 페이지와 같은 방식).
 */
export async function renderLedgerPdf(ledger: Ledger, meta: { issuedBy: string; issuedAt: Date }): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font: PDFFont = await doc.embedFont(await fs.readFile(FONT_PATH), { subset: true });

  const W = 595, H = 842, M = 44, BOTTOM = 48;
  let page: PDFPage = doc.addPage([W, H]);
  let y = H - M;
  let pageNo = 1;
  const newPage = () => {
    footer();
    page = doc.addPage([W, H]);
    pageNo++;
    y = H - M;
  };
  const footer = () => {
    try {
      page.drawText(`${ledger.user.name} · ${ledger.year}년 연차 대장 · ${pageNo}쪽 · 발행 ${kst(meta.issuedAt.toISOString())} (${meta.issuedBy})`, {
        x: M, y: 24, size: 8, font, color: rgb(0.55, 0.55, 0.55),
      });
    } catch { /* 이 줄만 건너뛴다 */ }
  };
  // 폭에 맞춰 줄바꿈
  const wrap = (text: string, size: number, maxW: number): string[] => {
    const out: string[] = [];
    let cur = "";
    for (const ch of text) {
      const next = cur + ch;
      let w = 0;
      try { w = font.widthOfTextAtSize(next, size); } catch { w = next.length * size; }
      if (w > maxW && cur) { out.push(cur); cur = ch; } else { cur = next; }
    }
    if (cur) out.push(cur);
    return out.length ? out : [""];
  };
  const line = (text: string, opts: { size?: number; x?: number; color?: RGB; gap?: number } = {}) => {
    const size = opts.size ?? 9.5;
    const x = opts.x ?? M;
    for (const t of wrap(text, size, W - M - x)) {
      if (y < BOTTOM) newPage();
      try { page.drawText(t, { x, y, size, font, color: opts.color ?? rgb(0.15, 0.15, 0.15) }); } catch { /* 이 줄만 */ }
      y -= size + (opts.gap ?? 4);
    }
  };
  const rule = () => {
    if (y < BOTTOM + 10) newPage();
    page.drawLine({ start: { x: M, y: y + 4 }, end: { x: W - M, y: y + 4 }, thickness: 0.6, color: rgb(0.82, 0.82, 0.82) });
    y -= 8;
  };

  // ── 머리 ──
  const u = ledger.user;
  line(`연차 대장 — ${u.name} (${ledger.year}년)`, { size: 16, color: rgb(0, 0, 0), gap: 8 });
  line(`소속 ${u.branch ?? "-"} · 직책 ${u.position ?? "-"} · 입사일 ${u.hireDate ? u.hireDate.slice(0, 10) : "-"}`);
  line(`발행 ${kst(meta.issuedAt.toISOString())} · 발행자 ${meta.issuedBy} · 연도 기준: 휴가를 쓰는 해(시작일)`, { color: rgb(0.45, 0.45, 0.45) });
  rule();

  // ── 잔여·대조 ──
  const b = ledger.balance;
  line(b ? `연차 잔여 — 총 ${b.total}일 · 사용 ${b.used}일 · 잔여 ${b.remaining}일` : "연차 잔여 — 이 해의 연차 기록이 없습니다", { size: 11, color: rgb(0, 0, 0) });
  const s = ledger.summary;
  line(
    `대조 — 승인된 연차 차감 휴가 합계 ${s.approvedDeductibleDays}일 / 잔여 기록의 사용 ${s.balanceUsed ?? "-"}일 → ` +
      (s.match === null ? "비교할 잔여 기록 없음" : s.match ? "일치" : "불일치(아래 잔여 조정 이력 확인)"),
    { color: s.match === false ? rgb(0.75, 0.1, 0.1) : rgb(0.15, 0.15, 0.15) }
  );
  rule();

  // ── 휴가 ──
  line(`휴가 ${ledger.entries.length}건`, { size: 11, color: rgb(0, 0, 0) });
  if (ledger.entries.length === 0) line("이 해에 신청한 휴가가 없습니다.");
  ledger.entries.forEach((e, i) => {
    y -= 2;
    line(
      `${i + 1}. ${e.startDate}${e.startDate !== e.endDate ? ` ~ ${e.endDate}` : ""} · ${TYPE_LABEL[e.type] ?? e.type} · ${e.days}일` +
        `${e.deductible ? "" : "(연차 미차감)"} · ${STATUS_LABEL[e.status] ?? e.status}`,
      { size: 10, color: rgb(0, 0, 0) }
    );
    line(`신청 ${kst(e.createdAt)}${e.reason ? ` · 사유: ${e.reason}` : ""}`, { x: M + 14 });
    if (e.rejectedReason) line(`반려 사유: ${e.rejectedReason}`, { x: M + 14, color: rgb(0.7, 0.1, 0.1) });
    for (const st of e.steps) {
      line(
        `결재 ${st.order}. ${ROLE_LABEL[st.role ?? ""] ?? "결재자"} ${st.approverName ?? ""} — ${STATUS_LABEL[st.status] ?? st.status}` +
          `${st.decidedAt ? ` ${kst(st.decidedAt)}` : ""}${st.comment ? ` (${st.comment})` : ""}`,
        { x: M + 14, color: rgb(0.3, 0.3, 0.3) }
      );
    }
    for (const c of e.cancelRequests) {
      line(
        `취소 요청 ${kst(c.createdAt)} — ${STATUS_LABEL[c.status] ?? c.status}${c.reason ? ` · 사유: ${c.reason}` : ""}` +
          `${c.rejectedReason ? ` · 반려/만료: ${c.rejectedReason}` : ""}`,
        { x: M + 14, color: rgb(0.55, 0.3, 0.05) }
      );
      for (const st of c.steps) {
        line(
          `취소 결재 ${st.order}. ${ROLE_LABEL[st.role ?? ""] ?? "결재자"} ${st.approverName ?? ""} — ${STATUS_LABEL[st.status] ?? st.status}` +
            `${st.decidedAt ? ` ${kst(st.decidedAt)}` : ""}${st.comment ? ` (${st.comment})` : ""}`,
          { x: M + 28, color: rgb(0.45, 0.35, 0.2) }
        );
      }
    }
  });
  rule();

  // ── 잔여 조정 이력 ──
  line(`잔여 조정 이력 ${ledger.adjustments.length}건`, { size: 11, color: rgb(0, 0, 0) });
  if (ledger.adjustments.length === 0) line("이 해에 잔여 조정 기록이 없습니다.");
  for (const a of ledger.adjustments) line(`${kst(a.at)} · ${a.actorName} · ${a.detail ?? ""}`, { x: M + 14 });

  footer();
  return Buffer.from(await doc.save());
}
