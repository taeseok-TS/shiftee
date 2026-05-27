#!/usr/bin/env node

/**
 * SMTP 연결 및 이메일 발송 테스트 스크립트
 */

require('dotenv').config({ path: '.env.local' });

const nodemailer = require('nodemailer');

async function testSMTP() {
  console.log('🔄 SMTP 연결 테스트 시작...\n');

  const config = {
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_PORT === '465',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  };

  console.log('📧 SMTP 설정:');
  console.log(`  - Host: ${config.host}`);
  console.log(`  - Port: ${config.port}`);
  console.log(`  - User: ${config.auth.user}`);
  console.log(`  - Secure: ${config.secure}\n`);

  const transporter = nodemailer.createTransport(config);

  try {
    console.log('⏳ SMTP 서버에 연결 중...');
    await transporter.verify();
    console.log('✅ SMTP 연결 성공!\n');

    // 테스트 이메일 발송
    console.log('📨 테스트 이메일 발송 중...');
    const result = await transporter.sendMail({
      from: `${process.env.SMTP_FROM_NAME} <${process.env.SMTP_FROM_EMAIL}>`,
      to: process.env.SMTP_USER, // 발신자 주소로 발송 (자신에게)
      subject: '[Shiftee] SMTP 테스트 이메일',
      html: `
        <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px;">
          <h2 style="color: #2563eb;">✅ SMTP 연결 성공!</h2>
          <p>이 이메일은 Shiftee HR 시스템의 SMTP 설정이 정상적으로 작동함을 확인하기 위한 테스트 이메일입니다.</p>

          <div style="background: #f5f5f5; padding: 15px; margin: 20px 0; border-left: 4px solid #10b981;">
            <p><strong>발신자:</strong> ${process.env.SMTP_FROM_NAME}</p>
            <p><strong>발신 시간:</strong> ${new Date().toLocaleString('ko-KR')}</p>
            <p><strong>상태:</strong> 정상</p>
          </div>

          <p style="margin-top: 30px; color: #666; font-size: 12px;">
            이 이메일은 자동 발송된 테스트 메일입니다.
          </p>
        </div>
      `,
    });

    console.log(`✅ 테스트 이메일 발송 성공!`);
    console.log(`  - Message ID: ${result.messageId}`);
    console.log(`  - 수신자: ${process.env.SMTP_USER}\n`);

    console.log('🎉 SMTP 설정이 모두 정상입니다!');
    process.exit(0);
  } catch (error) {
    console.error('❌ SMTP 오류 발생:');
    console.error(error.message);
    console.error('\n자세한 정보:');
    console.error(error);
    process.exit(1);
  }
}

testSMTP();
