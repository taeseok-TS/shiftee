import nodemailer from "nodemailer";
import { isDirectHost } from "@/lib/is-direct-host";

// Configure SMTP transporter
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || "587"),
  secure: process.env.SMTP_PORT === "465", // true for 465, false for other ports
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
  // 메일 서버가 응답하지 않을 때 요청이 몇 분씩 붙들리지 않게(기본값은 연결 2분·소켓 1시간).
  // 비밀번호 초기화처럼 메일 결과를 기다려 화면에 알리는 곳이 있다(2026-09-30 검증관 P-2).
  connectionTimeout: 15_000,
  greetingTimeout: 15_000,
  socketTimeout: 30_000,
});

interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  fromName?: string;   // 발신 이름(없으면 SMTP_FROM_NAME 또는 「큐브티」)
  attachments?: { filename: string; path: string; contentType?: string }[];   // 완료본 PDF(외부 계약자, 10/16 QA 7)
}

// 계약 메일의 발신 이름(2026-10-16 이예지 QA A5) — 처음 받는 직원이 「큐브티」만 보고 스팸·피싱으로 오해하지 않게
// 직영(cubetee.co.kr)은 「에듀플렉스 직영사업본부」가 먼저 보이게 한다. 판매용 고객사 인스턴스는 종전대로
// 직영 판별 규칙은 lib/is-direct-host 하나(검증 L6). 주소가 비었거나 못 읽으면 직영으로 보지 않는다
function contractSender(): { direct: boolean; fromName?: string; prefix: string } {
  try {
    const raw = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "";
    if (raw && isDirectHost(new URL(raw).host)) return { direct: true, fromName: "에듀플렉스 직영사업본부", prefix: "[에듀플렉스 직영사업본부] " };
  } catch { /* 주소를 못 읽으면 종전대로 */ }
  return { direct: false, prefix: "" };
}

/**
 * Send email via SMTP — 보냈으면 true. 실패는 던지지 않고 false (본 작업을 막지 않게).
 * (반환값은 2026-09-30 추가 — 임시 비밀번호 메일은 "갔는지"를 관리자에게 알려야 한다)
 */
async function sendEmail(options: EmailOptions): Promise<boolean> {
  try {
    if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
      console.warn("⚠️ SMTP credentials not configured. Email not sent.");
      console.warn(`To: ${options.to}, Subject: ${options.subject}`);
      return false;
    }

    // FROM_* 가 비면 "undefined <undefined>" 로 나간다. 발신 계정으로 대체하되,
    // Resend 처럼 SMTP_USER 가 이메일이 아닌 경우(사용자명이 "resend")까지 걸러낸다.
    const fromEmail = process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER || "";
    if (!fromEmail.includes("@")) {
      console.warn(`⚠️ SMTP_FROM_EMAIL 이 유효한 주소가 아닙니다 ("${fromEmail}"). Email not sent.`);
      console.warn(`To: ${options.to}, Subject: ${options.subject}`);
      return false;
    }

    const { fromName, ...mail } = options;
    const result = await transporter.sendMail({
      from: `${fromName || process.env.SMTP_FROM_NAME || "큐브티"} <${fromEmail}>`,
      ...mail,
    });

    console.log(`✅ Email sent to ${options.to}: ${result.messageId}`);
    return true;
  } catch (error) {
    console.error(`❌ Failed to send email to ${options.to}:`, error);
    // Don't throw - allow contract operations to continue even if email fails
    return false;
  }
}

const escapeHtml = (v: string) => v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

/**
 * 임시 비밀번호 안내 (2026-09-30) — 관리자 초기화(reset) / 새 계정 발급(new).
 * 로그인하면 본인 비밀번호로 바꾸도록 안내한다(24시간 뒤부터 봇이 매일 변경을 요청한다).
 * 보냈으면 true.
 */
export async function sendTempPassword(email: string, name: string, tempPassword: string, kind: "reset" | "new"): Promise<boolean> {
  const base = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "https://cubetee.co.kr";
  const title = kind === "new" ? "큐브티 계정이 만들어졌습니다" : "비밀번호가 초기화되었습니다";
  const lead = kind === "new"
    ? "큐브티 계정이 만들어졌습니다. 아래 이메일과 임시 비밀번호로 로그인해 주세요."
    : "관리자가 비밀번호를 초기화했습니다. 아래 임시 비밀번호로 로그인해 주세요. 이전 비밀번호와 로그인되어 있던 기기는 모두 해제되었습니다.";
  return sendEmail({
    to: email,
    subject: `[큐브티] ${title}`,
    html: `
      <div style="font-family: 'Malgun Gothic', sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; border: 1px solid #e5e7eb; border-radius: 12px;">
        <h2 style="color: #4f46e5; margin-top: 0;">${title}</h2>
        <p>${escapeHtml(name)} 님, 안녕하세요.</p>
        <p>${lead}</p>
        <table style="margin: 20px 0; border-collapse: collapse; font-size: 15px;">
          <tr><td style="padding: 6px 14px 6px 0; color: #6b7280;">이메일(아이디)</td><td style="padding: 6px 0;"><b>${escapeHtml(email)}</b></td></tr>
          <tr><td style="padding: 6px 14px 6px 0; color: #6b7280;">임시 비밀번호</td><td style="padding: 6px 0;"><b style="font-family: Consolas, monospace; font-size: 18px; letter-spacing: 1px; background: #eef2ff; padding: 4px 10px; border-radius: 6px;">${escapeHtml(tempPassword)}</b></td></tr>
        </table>
        <p style="font-size: 13px; color: #6b7280;">임시 비밀번호는 가운데 하이픈(-)까지 그대로, 모두 소문자로 입력해 주세요.</p>
        <p>로그인한 뒤 <b>본인만 아는 비밀번호로 꼭 바꿔 주세요.</b><br/>
          · 앱: 더보기 &gt; 설정 &gt; 비밀번호 변경<br/>
          · 웹: 환경설정 &gt; 비밀번호 변경</p>
        <p style="text-align: center; margin: 28px 0;">
          <a href="${base}/login" style="background: #4f46e5; color: #fff; text-decoration: none; padding: 12px 28px; border-radius: 8px; font-weight: bold;">큐브티 로그인</a>
        </p>
        <p style="font-size: 13px; color: #6b7280;">임시 비밀번호는 다른 사람에게 알려 주지 마세요. 본인이 요청하지 않은 초기화라면 관리자에게 알려 주세요.</p>
      </div>
    `,
  });
}

/**
 * 비밀번호 셀프 재설정 링크 발송 (1시간 유효)
 */
export async function sendPasswordReset(email: string, name: string, resetUrl: string): Promise<void> {
  await sendEmail({
    to: email,
    subject: "[큐브티] 비밀번호 재설정 안내",
    html: `
      <div style="font-family: 'Malgun Gothic', sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; border: 1px solid #e5e7eb; border-radius: 12px;">
        <h2 style="color: #4f46e5; margin-top: 0;">비밀번호 재설정</h2>
        <p>${name} 님, 안녕하세요.</p>
        <p>아래 버튼을 누르면 새 비밀번호를 설정할 수 있습니다. 링크는 <b>1시간 동안, 1회만</b> 사용할 수 있습니다.</p>
        <p style="text-align: center; margin: 28px 0;">
          <a href="${resetUrl}" style="background: #4f46e5; color: #fff; text-decoration: none; padding: 12px 28px; border-radius: 8px; font-weight: bold;">새 비밀번호 설정</a>
        </p>
        <p style="font-size: 13px; color: #6b7280;">버튼이 눌리지 않으면 다음 주소를 브라우저에 붙여넣으세요:<br/>${resetUrl}</p>
        <p style="font-size: 13px; color: #6b7280;">본인이 요청하지 않았다면 이 메일은 무시하셔도 됩니다. 비밀번호는 변경되지 않습니다.</p>
      </div>
    `,
  });
}

// 전자계약 메일 공통 틀(2026-10-08 #217-3) — 발신 표시·기한·보안 안내. 로고 파일이 없어 글자 머리말로 둔다
const kstYmd = (d?: Date | null) => (d ? new Date(d.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10) : null);
function contractMailShell(title: string, body: string, opts?: { external?: boolean }): string {
  // 직영은 「에듀플렉스 직영사업본부」, 판매용 고객사는 발신 이름(SMTP_FROM_NAME) 또는 큐브티(검증 L6)
  const org = contractSender().direct ? "에듀플렉스 직영사업본부" : escapeHtml(process.env.SMTP_FROM_NAME || "큐브티");
  return `
    <div style="font-family: Arial, 'Malgun Gothic', sans-serif; color: #333; max-width: 600px;">
      <div style="border-bottom: 2px solid #1e3a8a; padding-bottom: 8px; margin-bottom: 16px;">
        <span style="font-weight: bold; color: #1e3a8a; font-size: 15px;">${org}</span>
        <span style="color: #6b7280; font-size: 12px; margin-left: 8px;">${org === "큐브티" ? "전자계약" : "큐브티 전자계약"}</span>
      </div>
      <h2 style="margin: 0 0 12px 0; font-size: 18px;">${title}</h2>
      ${body}
      <p style="margin-top: 30px; color: #666; font-size: 12px; line-height: 1.6;">
        발신: ${org} · 큐브티 전자계약(자동 발송, 회신 불가)<br>
        ${opts?.external
          ? "문의는 계약서를 보낸 담당자에게 해 주세요."
          : "🔒 이 메일의 링크는 본인 전용입니다. 다른 사람에게 전달하지 마세요. 문의는 큐브티워크 메신저로 담당자에게 남겨 주세요."}
      </p>
    </div>
  `;
}

/**
 * Send contract notification when contract is sent to employee
 */
export async function sendContractNotification(
  employeeEmail: string,
  employeeName: string,
  contractTitle: string,
  appUrl: string,
  recipientId?: string, // 본인 확인 관문용 (#140) — 남의 세션으로 열리는 것 방지
  message?: string | null, // 본부 발송 메시지(#65)
  deadline?: Date | null, // 서명 기한(#45) — 메일에 보여 준다(#217-3)
  // 진행 문구 — 앞 단계(본부·원장) 서명 뒤 근로자 차례로 올 때(10/17 캡처 점검: 근로자에게 결재자용 문안이 갔다)
  progress?: { turn: string; text: string } | null
): Promise<void> {
  const { messageEmailHtml } = await import("@/lib/contract-send-meta");
  const html = contractMailShell("계약서 서명 요청", `
      <p>안녕하세요 ${employeeName}님,</p>
      <p>아래 계약서가 서명을 위해 발송되었습니다.</p>

      <div style="background: #f5f5f5; padding: 15px; margin: 20px 0; border-left: 4px solid #2563eb;">
        <p><strong>문서:</strong> ${contractTitle}</p>
        <p><strong>상태:</strong> 근로자 서명 대기</p>
        ${progress?.text ? `<p><strong>진행:</strong> ${progress.text}</p>` : ""}
        ${kstYmd(deadline) ? `<p><strong>서명 기한:</strong> ${kstYmd(deadline)}</p>` : ""}
      </div>
      ${messageEmailHtml(message)}

      <p>
        <a href="${recipientId ? `${appUrl}/contract-open/${recipientId}` : `${appUrl}/contracts`}" style="background: #2563eb; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">
          계약서 확인하고 서명하기
        </a>
      </p>
  `);

  const snd = contractSender();
  await sendEmail({
    to: employeeEmail,
    subject: snd.direct ? `${snd.prefix}${contractTitle} 서명 요청` : `[${contractTitle}] 계약서 서명 요청`,
    html,
    fromName: snd.fromName,
  });
}

/**
 * Send approval request notification to approver
 */
export async function sendApprovalRequest(
  approverEmail: string,
  approverName: string,
  contractTitle: string,
  employeeName: string,
  stepOrder: number,
  appUrl: string,
  // 본인 확인 관문용 (#140) — 링크 수신자
  recipientId?: string,
  message?: string | null, // 본부 발송 메시지(#65)
  deadline?: Date | null, // 서명 기한(#45)
  // 진행 문구(10/16 이예지 QA 8) — 예) 「본부 서명 완료 → 원장님 차례」. 없으면 종전 「N단계」
  progress?: { turn: string; text: string } | null
): Promise<void> {
  const { messageEmailHtml } = await import("@/lib/contract-send-meta");
  // 종전 「○○이(가) 서명한 계약서의 승인이 필요합니다」는 아직 서명 전인데 「서명한」으로 읽히고 조사도 그대로 나갔다(#217-3)
  const html = contractMailShell("계약서 결재(서명) 요청", `
      <p>안녕하세요 ${approverName}님,</p>
      <p>${employeeName}님의 계약서에 ${approverName}님의 결재(서명)가 필요합니다.</p>

      <div style="background: #f5f5f5; padding: 15px; margin: 20px 0; border-left: 4px solid #f59e0b;">
        <p><strong>문서:</strong> ${contractTitle}</p>
        <p><strong>계약 당사자:</strong> ${employeeName}</p>
        <p><strong>${progress ? "진행" : "결재 단계"}:</strong> ${progress ? progress.text : `${stepOrder}단계`}</p>
        <p><strong>상태:</strong> 결재 대기 중</p>
        ${kstYmd(deadline) ? `<p><strong>서명 기한:</strong> ${kstYmd(deadline)}</p>` : ""}
      </div>
      ${messageEmailHtml(message)}

      <p>
        <a href="${recipientId ? `${appUrl}/contract-open/${recipientId}` : `${appUrl}/contracts`}" style="background: #f59e0b; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">
          승인하기
        </a>
      </p>
  `);

  const snd = contractSender();
  await sendEmail({
    to: approverEmail,
    subject: `${snd.prefix}[결재 요청] ${contractTitle} - ${progress ? `${progress.turn} 결재(서명) 차례` : `${stepOrder}단계 결재(서명) 필요`}`,
    html,
    fromName: snd.fromName,
  });
}

/**
 * Send contract completion notification
 */
export async function sendContractCompletion(
  recipientEmail: string,
  recipientName: string,
  contractTitle: string,
  employeeName: string,
  appUrl: string,
  // 본인 확인 관문용 (#140) — 링크 수신자
  recipientId?: string
): Promise<boolean> {   // 실제로 보냈는가 — 교부 기록(#21)에 쓴다
  const html = contractMailShell("계약서 완료", `
      <p>안녕하세요 ${recipientName}님,</p>
      <p>다음 계약서가 모든 승인을 완료했습니다.</p>

      <div style="background: #f5f5f5; padding: 15px; margin: 20px 0; border-left: 4px solid #10b981;">
        <p><strong>문서:</strong> ${contractTitle}</p>
        <p><strong>계약 당사자:</strong> ${employeeName}</p>
        <p><strong>상태:</strong> 모든 서명·결재 완료</p>
      </div>

      <p>
        <a href="${recipientId ? `${appUrl}/contract-open/${recipientId}` : `${appUrl}/contracts`}" style="background: #10b981; color: white; padding: 10px 20px; text-decoration: none; border-radius: 4px; display: inline-block;">
          계약서 확인하기
        </a>
      </p>
  `);

  const snd = contractSender();
  return sendEmail({
    to: recipientEmail,
    subject: snd.direct ? `${snd.prefix}[완료] ${contractTitle} - 서명·결재가 모두 끝났습니다` : `[완료] ${contractTitle} - 모든 승인이 완료되었습니다`,
    html,
    fromName: snd.fromName,
  });
}

/** 외부(미가입) 계약자에게 완료본 PDF(10/16 이예지 QA 7) — 발송 때 받은 이메일로(lib/external-delivery 가 부른다) */
export async function sendExternalSignedCopy(
  to: string, name: string, title: string, pdf: { filename: string; path: string }
): Promise<boolean> {
  const html = contractMailShell("서명 완료 — 계약서 완료본", `
      <p>안녕하세요 ${escapeHtml(name)}님,</p>
      <p>아래 계약서의 서명·결재가 모두 끝났습니다. 완료본(PDF)을 이 메일에 붙여 보내 드립니다.</p>
      <div style="background: #f5f5f5; padding: 15px; margin: 20px 0; border-left: 4px solid #10b981;">
        <p><strong>문서:</strong> ${escapeHtml(title)}</p>
        <p><strong>상태:</strong> 모든 서명·결재 완료</p>
      </div>
      <p style="color:#6b7280;font-size:12px;">보안을 위해 서명 링크로는 더 이상 계약서가 열리지 않습니다. 이 메일의 첨부 파일을 보관해 주세요.</p>
  `, { external: true });
  const snd = contractSender();
  return sendEmail({
    to,
    subject: `${snd.prefix}[완료] ${title} - 계약서 완료본`,
    html,
    fromName: snd.fromName,
    attachments: [{ filename: pdf.filename, path: pdf.path, contentType: "application/pdf" }],
  });
}

/**
 * Send leave approval request notification to approver
 */
export async function sendLeaveApprovalRequest(
  approverEmail: string,
  approverName: string,
  requesterName: string,
  leaveType: string,
  startDate: string,
  endDate: string,
  reason: string,
  appUrl: string
,
  leaveId?: string): Promise<void> {
  const html = `
    <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px;">
      <h2>휴가 승인 요청</h2>
      <p>안녕하세요 ${approverName}님,</p>
      <p>${requesterName}님의 휴가 신청이 승인을 위해 도착했습니다.</p>

      <div style="background: #f5f5f5; padding: 15px; margin: 20px 0; border-left: 4px solid #3b82f6;">
        <p><strong>신청자:</strong> ${requesterName}</p>
        <p><strong>휴가 유형:</strong> ${leaveType}</p>
        <p><strong>기간:</strong> ${startDate} ~ ${endDate}</p>
        <p><strong>사유:</strong> ${reason || '없음'}</p>
        <p><strong>상태:</strong> 승인 대기 중</p>
      </div>

      <p>
        <!-- 승인자는 결재 화면에서 처리한다. /leave 는 본인이 '신청한' 목록이라 이 건이 안 보이고,
             /admin/* 은 원장(MANAGER)이 못 들어간다. team-leave 는 관리자·원장 모두 접근 가능. -->
        <a href="${appUrl}/manager/team-leave${leaveId ? `?id=${leaveId}` : ""}" style="background: #3b82f6; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">
          승인하기
        </a>
      </p>

      <p style="margin-top: 30px; color: #666; font-size: 12px;">
        이 이메일은 자동 발송된 메일입니다. 회신하셔도 답변받으실 수 없습니다.<br>
        문의는 큐브티워크 메신저로 담당자에게 남겨 주세요.
      </p>
    </div>
  `;

  await sendEmail({
    to: approverEmail,
    subject: `[휴가 승인] ${requesterName} - ${leaveType} (${startDate}~${endDate})`,
    html,
  });
}

/**
 * Send leave approval completion notification to requester
 */
export async function sendLeaveApprovalCompletion(
  requesterEmail: string,
  requesterName: string,
  leaveType: string,
  startDate: string,
  endDate: string,
  approverName: string,
  appUrl: string
,
  leaveId?: string): Promise<void> {
  const html = `
    <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px;">
      <h2>휴가 승인 완료</h2>
      <p>안녕하세요 ${requesterName}님,</p>
      <p>귀하의 휴가 신청이 승인되었습니다.</p>

      <div style="background: #f5f5f5; padding: 15px; margin: 20px 0; border-left: 4px solid #10b981;">
        <p><strong>휴가 유형:</strong> ${leaveType}</p>
        <p><strong>기간:</strong> ${startDate} ~ ${endDate}</p>
        <p><strong>승인자:</strong> ${approverName}</p>
        <p><strong>상태:</strong> 승인됨</p>
      </div>

      <p>
        <a href="${appUrl}/leave${leaveId ? `?id=${leaveId}` : ""}" style="background: #10b981; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">
          휴가 내역 확인
        </a>
      </p>

      <p style="margin-top: 30px; color: #666; font-size: 12px;">
        이 이메일은 자동 발송된 메일입니다. 회신하셔도 답변받으실 수 없습니다.<br>
        문의는 큐브티워크 메신저로 담당자에게 남겨 주세요.
      </p>
    </div>
  `;

  await sendEmail({
    to: requesterEmail,
    subject: `[휴가 승인 완료] ${leaveType} (${startDate}~${endDate})`,
    html,
  });
}

/**
 * Send leave rejection notification to requester
 */
export async function sendLeaveRejectionNotification(
  requesterEmail: string,
  requesterName: string,
  leaveType: string,
  startDate: string,
  endDate: string,
  approverName: string,
  reason: string | null,
  appUrl: string
,
  leaveId?: string): Promise<void> {
  const html = `
    <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px;">
      <h2>휴가 신청 반려</h2>
      <p>안녕하세요 ${requesterName}님,</p>
      <p>죄송하지만 귀하의 휴가 신청이 반려되었습니다.</p>

      <div style="background: #f5f5f5; padding: 15px; margin: 20px 0; border-left: 4px solid #ef4444;">
        <p><strong>휴가 유형:</strong> ${leaveType}</p>
        <p><strong>신청 기간:</strong> ${startDate} ~ ${endDate}</p>
        <p><strong>반려자:</strong> ${approverName}</p>
        ${reason ? `<p><strong>반려 사유:</strong> ${reason}</p>` : ''}
        <p><strong>상태:</strong> 반려됨</p>
      </div>

      <p>다시 신청하시려면 아래 링크를 클릭해주세요.</p>
      <p>
        <a href="${appUrl}/leave${leaveId ? `?id=${leaveId}` : ""}" style="background: #ef4444; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">
          휴가 신청하기
        </a>
      </p>

      <p style="margin-top: 30px; color: #666; font-size: 12px;">
        이 이메일은 자동 발송된 메일입니다. 회신하셔도 답변받으실 수 없습니다.<br>
        문의는 큐브티워크 메신저로 담당자에게 남겨 주세요.
      </p>
    </div>
  `;

  await sendEmail({
    to: requesterEmail,
    subject: `[휴가 신청 반려] ${leaveType} (${startDate}~${endDate})`,
    html,
  });
}

/**
 * Test SMTP connection
 */
export async function testSMTPConnection(): Promise<boolean> {
  try {
    await transporter.verify();
    console.log("✅ SMTP connection successful");
    return true;
  } catch (error) {
    console.error("❌ SMTP connection failed:", error);
    return false;
  }
}
