import { NextRequest, NextResponse } from "next/server";
import { testSMTPConnection, sendLeaveApprovalRequest } from "@/lib/email";

/**
 * SMTP 연결 테스트 및 테스트 이메일 발송
 * GET /api/test/smtp - 연결만 테스트
 * POST /api/test/smtp - 테스트 이메일 발송
 */

export async function GET() {
  try {
    const isConnected = await testSMTPConnection();

    if (isConnected) {
      return NextResponse.json({
        success: true,
        message: "✅ SMTP 연결 성공!",
        config: {
          host: process.env.SMTP_HOST,
          port: process.env.SMTP_PORT,
          from: `${process.env.SMTP_FROM_NAME} <${process.env.SMTP_FROM_EMAIL}>`,
        },
      });
    } else {
      return NextResponse.json({
        success: false,
        message: "❌ SMTP 연결 실패",
      }, { status: 500 });
    }
  } catch (error) {
    console.error("SMTP 테스트 오류:", error);
    return NextResponse.json({
      success: false,
      message: "❌ SMTP 테스트 중 오류 발생",
      error: String(error),
    }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { recipientEmail, testType = "leave" } = body;

    if (!recipientEmail) {
      return NextResponse.json({
        success: false,
        message: "recipientEmail은 필수입니다",
      }, { status: 400 });
    }

    if (testType === "leave") {
      // 휴가 승인 요청 테스트 이메일
      await sendLeaveApprovalRequest(
        recipientEmail,
        "테스트 승인자",
        "김철수",
        "연차",
        "2026-06-01",
        "2026-06-03",
        "가족 행사",
        "http://localhost:3000"
      );
    }

    return NextResponse.json({
      success: true,
      message: `✅ 테스트 이메일이 ${recipientEmail}로 발송되었습니다!`,
    });
  } catch (error) {
    console.error("테스트 이메일 발송 오류:", error);
    return NextResponse.json({
      success: false,
      message: "❌ 테스트 이메일 발송 실패",
      error: String(error),
    }, { status: 500 });
  }
}
