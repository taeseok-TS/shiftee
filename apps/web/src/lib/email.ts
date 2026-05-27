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
    if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
      console.warn("⚠️ SMTP credentials not configured. Email not sent.");
      console.warn(`To: ${options.to}, Subject: ${options.subject}`);
      return;
    }

    const result = await transporter.sendMail({
      from: `${process.env.SMTP_FROM_NAME} <${process.env.SMTP_FROM_EMAIL}>`,
      ...options,
    });

    console.log(`✅ Email sent to ${options.to}: ${result.messageId}`);
  } catch (error) {
    console.error(`❌ Failed to send email to ${options.to}:`, error);
    // Don't throw - allow contract operations to continue even if email fails
  }
}

/**
 * Send contract notification when contract is sent to employee
 */
export async function sendContractNotification(
  employeeEmail: string,
  employeeName: string,
  contractTitle: string,
  appUrl: string
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
        <a href="${appUrl}/contracts" style="background: #2563eb; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">
          계약서 확인하기
        </a>
      </p>

      <p style="margin-top: 30px; color: #666; font-size: 12px;">
        이 이메일은 자동 발송된 메일입니다. 회신하지 마세요.
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
  appUrl: string
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
        <a href="${appUrl}/contracts" style="background: #f59e0b; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">
          승인하기
        </a>
      </p>

      <p style="margin-top: 30px; color: #666; font-size: 12px;">
        이 이메일은 자동 발송된 메일입니다. 회신하지 마세요.
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
  appUrl: string
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
        <a href="${appUrl}/contracts" style="background: #10b981; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">
          계약서 확인하기
        </a>
      </p>

      <p style="margin-top: 30px; color: #666; font-size: 12px;">
        이 이메일은 자동 발송된 메일입니다. 회신하지 마세요.
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
): Promise<void> {
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
        <a href="${appUrl}/leave" style="background: #3b82f6; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">
          승인하기
        </a>
      </p>

      <p style="margin-top: 30px; color: #666; font-size: 12px;">
        이 이메일은 자동 발송된 메일입니다. 회신하지 마세요.
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
): Promise<void> {
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
        <a href="${appUrl}/leave" style="background: #10b981; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">
          휴가 내역 확인
        </a>
      </p>

      <p style="margin-top: 30px; color: #666; font-size: 12px;">
        이 이메일은 자동 발송된 메일입니다. 회신하지 마세요.
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
): Promise<void> {
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
        <a href="${appUrl}/leave" style="background: #ef4444; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">
          휴가 신청하기
        </a>
      </p>

      <p style="margin-top: 30px; color: #666; font-size: 12px;">
        이 이메일은 자동 발송된 메일입니다. 회신하지 마세요.
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
