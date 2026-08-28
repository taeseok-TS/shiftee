import nodemailer from "nodemailer";

// Configure SMTP transporter
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || "587"),
  secure: process.env.SMTP_PORT === "465", // true for 465, false for other ports
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

interface EmailOptions {
  to: string;
  subject: string;
  html: string;
}

/**
 * Send email via SMTP
 */
async function sendEmail(options: EmailOptions): Promise<void> {
  try {
    if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
      console.warn("⚠️ SMTP credentials not configured. Email not sent.");
      console.warn(`To: ${options.to}, Subject: ${options.subject}`);
      return;
    }

    // FROM_* 가 비면 "undefined <undefined>" 로 나간다. 발신 계정으로 대체하되,
    // Resend 처럼 SMTP_USER 가 이메일이 아닌 경우(사용자명이 "resend")까지 걸러낸다.
    const fromEmail = process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER || "";
    if (!fromEmail.includes("@")) {
      console.warn(`⚠️ SMTP_FROM_EMAIL 이 유효한 주소가 아닙니다 ("${fromEmail}"). Email not sent.`);
      console.warn(`To: ${options.to}, Subject: ${options.subject}`);
      return;
    }

    const result = await transporter.sendMail({
      from: `${process.env.SMTP_FROM_NAME || "큐브티"} <${fromEmail}>`,
      ...options,
    });

    console.log(`✅ Email sent to ${options.to}: ${result.messageId}`);
  } catch (error) {
    console.error(`❌ Failed to send email to ${options.to}:`, error);
    // Don't throw - allow contract operations to continue even if email fails
  }
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

/**
 * Send contract notification when contract is sent to employee
 */
export async function sendContractNotification(
  employeeEmail: string,
  employeeName: string,
  contractTitle: string,
  appUrl: string,
  recipientId?: string // 본인 확인 관문용 (#140) — 남의 세션으로 열리는 것 방지
): Promise<void> {
  const html = `
    <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px;">
      <h2>계약서 발송 안내</h2>
      <p>안녕하세요 ${employeeName}님,</p>
      <p>다음 계약서가 서명을 위해 발송되었습니다:</p>

      <div style="background: #f5f5f5; padding: 15px; margin: 20px 0; border-left: 4px solid #2563eb;">
        <p><strong>계약서명:</strong> ${contractTitle}</p>
        <p><strong>상태:</strong> 직원 서명 대기</p>
      </div>

      <p>
        <a href="${recipientId ? `${appUrl}/contract-open/${recipientId}` : `${appUrl}/contracts`}" style="background: #2563eb; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">
          계약서 확인하기
        </a>
      </p>

      <p style="margin-top: 30px; color: #666; font-size: 12px;">
        이 이메일은 자동 발송된 메일입니다. 회신하셔도 답변받으실 수 없습니다.<br>
        문의는 큐브티워크 메신저로 담당자에게 남겨 주세요.
      </p>
    </div>
  `;

  await sendEmail({
    to: employeeEmail,
    subject: `[${contractTitle}] 계약서 서명 요청`,
    html,
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
  recipientId?: string
): Promise<void> {
  const html = `
    <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px;">
      <h2>계약서 승인 요청</h2>
      <p>안녕하세요 ${approverName}님,</p>
      <p>${employeeName}이(가) 서명한 계약서의 승인이 필요합니다.</p>

      <div style="background: #f5f5f5; padding: 15px; margin: 20px 0; border-left: 4px solid #f59e0b;">
        <p><strong>계약서명:</strong> ${contractTitle}</p>
        <p><strong>신청자:</strong> ${employeeName}</p>
        <p><strong>승인 단계:</strong> ${stepOrder}단계</p>
        <p><strong>상태:</strong> 승인 대기 중</p>
      </div>

      <p>
        <a href="${recipientId ? `${appUrl}/contract-open/${recipientId}` : `${appUrl}/contracts`}" style="background: #f59e0b; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">
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
    subject: `[승인 요청] ${contractTitle} - ${stepOrder}단계 승인 필요`,
    html,
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
): Promise<void> {
  const html = `
    <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px;">
      <h2>계약서 완료</h2>
      <p>안녕하세요 ${recipientName}님,</p>
      <p>다음 계약서가 모든 승인을 완료했습니다.</p>

      <div style="background: #f5f5f5; padding: 15px; margin: 20px 0; border-left: 4px solid #10b981;">
        <p><strong>계약서명:</strong> ${contractTitle}</p>
        <p><strong>신청자:</strong> ${employeeName}</p>
        <p><strong>상태:</strong> 모든 승인 완료</p>
      </div>

      <p>
        <a href="${recipientId ? `${appUrl}/contract-open/${recipientId}` : `${appUrl}/contracts`}" style="background: #10b981; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">
          계약서 확인하기
        </a>
      </p>

      <p style="margin-top: 30px; color: #666; font-size: 12px;">
        이 이메일은 자동 발송된 메일입니다. 회신하셔도 답변받으실 수 없습니다.<br>
        문의는 큐브티워크 메신저로 담당자에게 남겨 주세요.
      </p>
    </div>
  `;

  await sendEmail({
    to: recipientEmail,
    subject: `[완료] ${contractTitle} - 모든 승인이 완료되었습니다`,
    html,
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
