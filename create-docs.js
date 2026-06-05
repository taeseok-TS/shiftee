const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, HeadingLevel, AlignmentType, BorderStyle, WidthType, ShadingType, PageBreak } = require('./apps/web/node_modules/docx');
const fs = require('fs');

const border = { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' };
const borders = { top: border, bottom: border, left: border, right: border };

const doc1 = new Document({
  styles: {
    default: { document: { run: { font: 'Arial', size: 22 } } },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 32, bold: true, font: 'Arial', color: '1F4788' },
        paragraph: { spacing: { before: 240, after: 120 }, outlineLevel: 0 } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 28, bold: true, font: 'Arial', color: '2E75B6' },
        paragraph: { spacing: { before: 180, after: 100 }, outlineLevel: 1 } }
    ]
  },
  numbering: {
    config: [{ reference: 'bullets', levels: [{ level: 0, format: 'bullet', text: '•', alignment: 'left', style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] }]
  },
  sections: [{
    properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } },
    children: [
      new Paragraph({ heading: HeadingLevel.HEADING_1, alignment: AlignmentType.CENTER, spacing: { after: 240 }, children: [new TextRun({ text: 'SHIFTEE HR SYSTEM', size: 48, bold: true, color: '1F4788' })] }),
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 120 }, children: [new TextRun({ text: '시프티 인사관리 시스템', size: 32, bold: true })] }),
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 240 }, children: [new TextRun({ text: '프로젝트 구현 완료 보고서', size: 28, color: '595959' })] }),
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 480 }, children: [new TextRun({ text: '작성일: 2026년 5월 28일', size: 22, italics: true })] }),

      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('1. 프로젝트 개요')] }),
      new Paragraph({ spacing: { after: 240 }, children: [new TextRun('Shiftee는 중소 교육기관을 위한 포괄적인 인사관리 시스템입니다. 직원 관리, 계약서 관리, 근무 일정, 휴가 신청 등 인사 업무의 전 영역을 디지털화하여 조직 효율성을 높입니다.')] }),

      new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun('주요 목표')] }),
      new Paragraph({ spacing: { after: 120 }, numbering: { reference: 'bullets', level: 0 }, children: [new TextRun('직원 정보 중앙 관리 및 조직 구조 시각화')] }),
      new Paragraph({ spacing: { after: 120 }, numbering: { reference: 'bullets', level: 0 }, children: [new TextRun('전자 계약서 생성, 서명, 승인 자동화')] }),
      new Paragraph({ spacing: { after: 120 }, numbering: { reference: 'bullets', level: 0 }, children: [new TextRun('출퇴근 및 근무 일정 관리')] }),
      new Paragraph({ spacing: { after: 120 }, numbering: { reference: 'bullets', level: 0 }, children: [new TextRun('휴가 신청 및 승인 프로세스 자동화')] }),
      new Paragraph({ spacing: { after: 120 }, numbering: { reference: 'bullets', level: 0 }, children: [new TextRun('직원 현황 통계 및 대시보드')] }),
      new Paragraph({ spacing: { after: 480 }, numbering: { reference: 'bullets', level: 0 }, children: [new TextRun('자동화된 이메일 알림 시스템')] }),

      new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun('기술 스택')] }),
      new Table({ width: { size: 9360, type: WidthType.DXA }, columnWidths: [2340, 7020],
        rows: [
          new TableRow({ children: [
            new TableCell({ borders, width: { size: 2340, type: WidthType.DXA }, shading: { fill: 'D5E8F0', type: ShadingType.CLEAR }, margins: { top: 80, bottom: 80, left: 120, right: 120 }, children: [new Paragraph({ children: [new TextRun({ text: '항목', bold: true })] })] }),
            new TableCell({ borders, width: { size: 7020, type: WidthType.DXA }, shading: { fill: 'D5E8F0', type: ShadingType.CLEAR }, margins: { top: 80, bottom: 80, left: 120, right: 120 }, children: [new Paragraph({ children: [new TextRun({ text: '기술', bold: true })] })] })
          ] }),
          new TableRow({ children: [
            new TableCell({ borders, width: { size: 2340, type: WidthType.DXA }, margins: { top: 80, bottom: 80, left: 120, right: 120 }, children: [new Paragraph({ children: [new TextRun('프레임워크')] })] }),
            new TableCell({ borders, width: { size: 7020, type: WidthType.DXA }, margins: { top: 80, bottom: 80, left: 120, right: 120 }, children: [new Paragraph({ children: [new TextRun('Next.js 16.2.6 (Turbopack), React 19')] })] })
          ] }),
          new TableRow({ children: [
            new TableCell({ borders, width: { size: 2340, type: WidthType.DXA }, margins: { top: 80, bottom: 80, left: 120, right: 120 }, children: [new Paragraph({ children: [new TextRun('UI')] })] }),
            new TableCell({ borders, width: { size: 7020, type: WidthType.DXA }, margins: { top: 80, bottom: 80, left: 120, right: 120 }, children: [new Paragraph({ children: [new TextRun('Tailwind CSS + shadcn/ui')] })] })
          ] }),
          new TableRow({ children: [
            new TableCell({ borders, width: { size: 2340, type: WidthType.DXA }, margins: { top: 80, bottom: 80, left: 120, right: 120 }, children: [new Paragraph({ children: [new TextRun('데이터베이스')] })] }),
            new TableCell({ borders, width: { size: 7020, type: WidthType.DXA }, margins: { top: 80, bottom: 80, left: 120, right: 120 }, children: [new Paragraph({ children: [new TextRun('PostgreSQL (Prisma ORM)')] })] })
          ] }),
          new TableRow({ children: [
            new TableCell({ borders, width: { size: 2340, type: WidthType.DXA }, margins: { top: 80, bottom: 80, left: 120, right: 120 }, children: [new Paragraph({ children: [new TextRun('인증')] })] }),
            new TableCell({ borders, width: { size: 7020, type: WidthType.DXA }, margins: { top: 80, bottom: 80, left: 120, right: 120 }, children: [new Paragraph({ children: [new TextRun('JWT with httpOnly Cookies')] })] })
          ] }),
          new TableRow({ children: [
            new TableCell({ borders, width: { size: 2340, type: WidthType.DXA }, margins: { top: 80, bottom: 80, left: 120, right: 120 }, children: [new Paragraph({ children: [new TextRun('이메일')] })] }),
            new TableCell({ borders, width: { size: 7020, type: WidthType.DXA }, margins: { top: 80, bottom: 80, left: 120, right: 120 }, children: [new Paragraph({ children: [new TextRun('Nodemailer + Gmail SMTP')] })] })
          ] }),
          new TableRow({ children: [
            new TableCell({ borders, width: { size: 2340, type: WidthType.DXA }, margins: { top: 80, bottom: 80, left: 120, right: 120 }, children: [new Paragraph({ children: [new TextRun('내보내기')] })] }),
            new TableCell({ borders, width: { size: 7020, type: WidthType.DXA }, margins: { top: 80, bottom: 80, left: 120, right: 120 }, children: [new Paragraph({ children: [new TextRun('XLSX (Excel export)')] })] })
          ] })
        ]
      }),
      new Paragraph({ spacing: { after: 480 }, children: [new TextRun('')] }),

      new Paragraph({ children: [new PageBreak()] }),

      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('2. 구현 완료 기능')] }),

      new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun('2.1 직원 관리 시스템')] }),
      new Paragraph({ spacing: { after: 120 }, numbering: { reference: 'bullets', level: 0 }, children: [new TextRun('직원 정보 추가, 수정, 삭제 (Soft-delete)')] }),
      new Paragraph({ spacing: { after: 120 }, numbering: { reference: 'bullets', level: 0 }, children: [new TextRun('직급, 직군, 부서, 지점별 분류')] }),
      new Paragraph({ spacing: { after: 120 }, numbering: { reference: 'bullets', level: 0 }, children: [new TextRun('입사일, 퇴사일, 퇴사 사유 기록')] }),
      new Paragraph({ spacing: { after: 240 }, numbering: { reference: 'bullets', level: 0 }, children: [new TextRun('직원 상태 관리 (재직, 퇴직, 휴직)')] }),

      new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun('2.2 지점 관리')] }),
      new Paragraph({ spacing: { after: 120 }, numbering: { reference: 'bullets', level: 0 }, children: [new TextRun('조직의 모든 지점 중앙 관리')] }),
      new Paragraph({ spacing: { after: 120 }, numbering: { reference: 'bullets', level: 0 }, children: [new TextRun('지점별 직원 할당')] }),
      new Paragraph({ spacing: { after: 240 }, numbering: { reference: 'bullets', level: 0 }, children: [new TextRun('역할 기반 접근: ADMIN(전체) vs MANAGER(자신의 지점)')] }),

      new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun('2.3 현황 통계 대시보드')] }),
      new Paragraph({ spacing: { after: 120 }, numbering: { reference: 'bullets', level: 0 }, children: [new TextRun('재직자 현황: 월별/연별 통계')] }),
      new Paragraph({ spacing: { after: 120 }, numbering: { reference: 'bullets', level: 0 }, children: [new TextRun('직급별 인원 분포')] }),
      new Paragraph({ spacing: { after: 120 }, numbering: { reference: 'bullets', level: 0 }, children: [new TextRun('지점별 인원 세부 현황')] }),
      new Paragraph({ spacing: { after: 120 }, numbering: { reference: 'bullets', level: 0 }, children: [new TextRun('퇴직자 현황: 월별/연간 통계')] }),
      new Paragraph({ spacing: { after: 240 }, numbering: { reference: 'bullets', level: 0 }, children: [new TextRun('포인트 인 타임(Point-in-Time) 쿼리')] }),

      new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun('2.4 데이터 내보내기')] }),
      new Paragraph({ spacing: { after: 120 }, numbering: { reference: 'bullets', level: 0 }, children: [new TextRun('재직자 현황 Excel 다운로드')] }),
      new Paragraph({ spacing: { after: 120 }, numbering: { reference: 'bullets', level: 0 }, children: [new TextRun('퇴직자 명단 내보내기')] }),
      new Paragraph({ spacing: { after: 240 }, numbering: { reference: 'bullets', level: 0 }, children: [new TextRun('통계 요약 데이터 제공')] }),

      new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun('2.5 인증 및 보안')] }),
      new Paragraph({ spacing: { after: 120 }, numbering: { reference: 'bullets', level: 0 }, children: [new TextRun('JWT 기반 인증 시스템')] }),
      new Paragraph({ spacing: { after: 120 }, numbering: { reference: 'bullets', level: 0 }, children: [new TextRun('httpOnly 쿠키 저장')] }),
      new Paragraph({ spacing: { after: 120 }, numbering: { reference: 'bullets', level: 0 }, children: [new TextRun('역할 기반 접근 제어 (RBAC)')] }),
      new Paragraph({ spacing: { after: 240 }, numbering: { reference: 'bullets', level: 0 }, children: [new TextRun('미들웨어를 통한 요청 검증')] }),

      new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun('2.6 이메일 알림 시스템')] }),
      new Paragraph({ spacing: { after: 120 }, numbering: { reference: 'bullets', level: 0 }, children: [new TextRun('Nodemailer + Gmail SMTP')] }),
      new Paragraph({ spacing: { after: 120 }, numbering: { reference: 'bullets', level: 0 }, children: [new TextRun('계약서 발송/승인 알림')] }),
      new Paragraph({ spacing: { after: 120 }, numbering: { reference: 'bullets', level: 0 }, children: [new TextRun('자동 이메일 발송')] }),
      new Paragraph({ spacing: { after: 240 }, numbering: { reference: 'bullets', level: 0 }, children: [new TextRun('HTML 이메일 템플릿')] }),

      new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun('2.7 계약서 관리')] }),
      new Paragraph({ spacing: { after: 120 }, numbering: { reference: 'bullets', level: 0 }, children: [new TextRun('생성, 발송, 서명, 승인 워크플로우')] }),
      new Paragraph({ spacing: { after: 120 }, numbering: { reference: 'bullets', level: 0 }, children: [new TextRun('다단계 승인 단계 관리')] }),
      new Paragraph({ spacing: { after: 120 }, numbering: { reference: 'bullets', level: 0 }, children: [new TextRun('계약 기간 설정')] }),
      new Paragraph({ spacing: { after: 240 }, numbering: { reference: 'bullets', level: 0 }, children: [new TextRun('계약서 첨부 파일 지원')] }),

      new Paragraph({ children: [new PageBreak()] }),

      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('3. 데이터베이스 구조')] }),

      new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun('주요 모델')] }),

      new Paragraph({ spacing: { after: 240 }, children: [new TextRun('User: 직원 정보 (id, name, email, password, role, department, position, jobGroup, branch, hireDate, resignDate, resignReason, employmentStatus, isActive)')] }),
      new Paragraph({ spacing: { after: 240 }, children: [new TextRun('Branch: 지점 정보 (id, name, managerUsers)')] }),
      new Paragraph({ spacing: { after: 240 }, children: [new TextRun('Contract: 계약서 (id, employeeId, title, type, startDate, endDate, status, approverSteps)')] }),
      new Paragraph({ spacing: { after: 240 }, children: [new TextRun('Leave: 휴가 신청 (id, userId, type, startDate, endDate, status, approvalSteps)')] }),
      new Paragraph({ spacing: { after: 240 }, children: [new TextRun('EmploymentStatus Enum: ACTIVE, RESIGNED, ON_LEAVE, TEMPORARY')] }),

      new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun('포인트 인 타임 쿼리')] }),
      new Paragraph({ spacing: { after: 120 }, children: [new TextRun('특정 시점의 재직 직원 조회 필터:')] }),
      new Paragraph({ spacing: { after: 120 }, numbering: { reference: 'bullets', level: 0 }, children: [new TextRun('hireDate ≤ targetDate')] }),
      new Paragraph({ spacing: { after: 120 }, numbering: { reference: 'bullets', level: 0 }, children: [new TextRun('resignDate IS NULL OR resignDate > targetDate')] }),
      new Paragraph({ spacing: { after: 240 }, numbering: { reference: 'bullets', level: 0 }, children: [new TextRun('employmentStatus = ACTIVE')] }),

      new Paragraph({ children: [new PageBreak()] }),

      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('4. 주요 API 엔드포인트')] }),

      new Table({ width: { size: 9360, type: WidthType.DXA }, columnWidths: [2340, 2340, 4680],
        rows: [
          new TableRow({ children: [
            new TableCell({ borders, width: { size: 2340, type: WidthType.DXA }, shading: { fill: 'D5E8F0', type: ShadingType.CLEAR }, margins: { top: 80, bottom: 80, left: 120, right: 120 }, children: [new Paragraph({ children: [new TextRun({ text: '엔드포인트', bold: true })] })] }),
            new TableCell({ borders, width: { size: 2340, type: WidthType.DXA }, shading: { fill: 'D5E8F0', type: ShadingType.CLEAR }, margins: { top: 80, bottom: 80, left: 120, right: 120 }, children: [new Paragraph({ children: [new TextRun({ text: '메서드', bold: true })] })] }),
            new TableCell({ borders, width: { size: 4680, type: WidthType.DXA }, shading: { fill: 'D5E8F0', type: ShadingType.CLEAR }, margins: { top: 80, bottom: 80, left: 120, right: 120 }, children: [new Paragraph({ children: [new TextRun({ text: '설명', bold: true })] })] })
          ] }),
          new TableRow({ children: [
            new TableCell({ borders, width: { size: 2340, type: WidthType.DXA }, margins: { top: 80, bottom: 80, left: 120, right: 120 }, children: [new Paragraph({ children: [new TextRun('/api/employees')] })] }),
            new TableCell({ borders, width: { size: 2340, type: WidthType.DXA }, margins: { top: 80, bottom: 80, left: 120, right: 120 }, children: [new Paragraph({ children: [new TextRun('GET/POST')] })] }),
            new TableCell({ borders, width: { size: 4680, type: WidthType.DXA }, margins: { top: 80, bottom: 80, left: 120, right: 120 }, children: [new Paragraph({ children: [new TextRun('직원 목록 조회/추가')] })] })
          ] }),
          new TableRow({ children: [
            new TableCell({ borders, width: { size: 2340, type: WidthType.DXA }, margins: { top: 80, bottom: 80, left: 120, right: 120 }, children: [new Paragraph({ children: [new TextRun('/api/employees/[id]')] })] }),
            new TableCell({ borders, width: { size: 2340, type: WidthType.DXA }, margins: { top: 80, bottom: 80, left: 120, right: 120 }, children: [new Paragraph({ children: [new TextRun('GET/PATCH/DELETE')] })] }),
            new TableCell({ borders, width: { size: 4680, type: WidthType.DXA }, margins: { top: 80, bottom: 80, left: 120, right: 120 }, children: [new Paragraph({ children: [new TextRun('직원 상세/수정/삭제')] })] })
          ] }),
          new TableRow({ children: [
            new TableCell({ borders, width: { size: 2340, type: WidthType.DXA }, margins: { top: 80, bottom: 80, left: 120, right: 120 }, children: [new Paragraph({ children: [new TextRun('/api/employees/stats/active')] })] }),
            new TableCell({ borders, width: { size: 2340, type: WidthType.DXA }, margins: { top: 80, bottom: 80, left: 120, right: 120 }, children: [new Paragraph({ children: [new TextRun('GET')] })] }),
            new TableCell({ borders, width: { size: 4680, type: WidthType.DXA }, margins: { top: 80, bottom: 80, left: 120, right: 120 }, children: [new Paragraph({ children: [new TextRun('재직자 현황 통계')] })] })
          ] }),
          new TableRow({ children: [
            new TableCell({ borders, width: { size: 2340, type: WidthType.DXA }, margins: { top: 80, bottom: 80, left: 120, right: 120 }, children: [new Paragraph({ children: [new TextRun('/api/employees/stats/resigned')] })] }),
            new TableCell({ borders, width: { size: 2340, type: WidthType.DXA }, margins: { top: 80, bottom: 80, left: 120, right: 120 }, children: [new Paragraph({ children: [new TextRun('GET')] })] }),
            new TableCell({ borders, width: { size: 4680, type: WidthType.DXA }, margins: { top: 80, bottom: 80, left: 120, right: 120 }, children: [new Paragraph({ children: [new TextRun('퇴직자 현황 통계')] })] })
          ] }),
          new TableRow({ children: [
            new TableCell({ borders, width: { size: 2340, type: WidthType.DXA }, margins: { top: 80, bottom: 80, left: 120, right: 120 }, children: [new Paragraph({ children: [new TextRun('/api/branches')] })] }),
            new TableCell({ borders, width: { size: 2340, type: WidthType.DXA }, margins: { top: 80, bottom: 80, left: 120, right: 120 }, children: [new Paragraph({ children: [new TextRun('GET/POST')] })] }),
            new TableCell({ borders, width: { size: 4680, type: WidthType.DXA }, margins: { top: 80, bottom: 80, left: 120, right: 120 }, children: [new Paragraph({ children: [new TextRun('지점 관리')] })] })
          ] }),
          new TableRow({ children: [
            new TableCell({ borders, width: { size: 2340, type: WidthType.DXA }, margins: { top: 80, bottom: 80, left: 120, right: 120 }, children: [new Paragraph({ children: [new TextRun('/api/contracts')] })] }),
            new TableCell({ borders, width: { size: 2340, type: WidthType.DXA }, margins: { top: 80, bottom: 80, left: 120, right: 120 }, children: [new Paragraph({ children: [new TextRun('GET/POST')] })] }),
            new TableCell({ borders, width: { size: 4680, type: WidthType.DXA }, margins: { top: 80, bottom: 80, left: 120, right: 120 }, children: [new Paragraph({ children: [new TextRun('계약서 관리')] })] })
          ] })
        ]
      }),
      new Paragraph({ spacing: { after: 480 }, children: [new TextRun('')] }),

      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('5. 프로젝트 구조')] }),
      new Paragraph({ spacing: { after: 120 }, numbering: { reference: 'bullets', level: 0 }, children: [new TextRun('apps/web: Next.js 웹 애플리케이션')] }),
      new Paragraph({ spacing: { after: 120 }, numbering: { reference: 'bullets', level: 0 }, children: [new TextRun('packages/db: Prisma 데이터베이스 스키마')] }),
      new Paragraph({ spacing: { after: 480 }, numbering: { reference: 'bullets', level: 0 }, children: [new TextRun('apps/mobile: (향후) Expo React Native')] })
    ]
  }]
});

Packer.toBuffer(doc1).then(buffer => {
  fs.writeFileSync('Shiftee_Implementation_Summary.docx', buffer);
  console.log('✓ Implementation summary document created!');

  // Create roadmap document
  const doc2 = new Document({
    styles: {
      default: { document: { run: { font: 'Arial', size: 22 } } },
      paragraphStyles: [
        { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { size: 32, bold: true, font: 'Arial', color: '1F4788' },
          paragraph: { spacing: { before: 240, after: 120 }, outlineLevel: 0 } },
        { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { size: 28, bold: true, font: 'Arial', color: '2E75B6' },
          paragraph: { spacing: { before: 180, after: 100 }, outlineLevel: 1 } }
      ]
    },
    numbering: {
      config: [{ reference: 'bullets', levels: [{ level: 0, format: 'bullet', text: '•', alignment: 'left', style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] }]
    },
    sections: [{
      properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } },
      children: [
        new Paragraph({ heading: HeadingLevel.HEADING_1, alignment: AlignmentType.CENTER, spacing: { after: 240 }, children: [new TextRun({ text: 'SHIFTEE HR SYSTEM', size: 48, bold: true, color: '1F4788' })] }),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 120 }, children: [new TextRun({ text: '향후 기획 및 로드맵', size: 32, bold: true })] }),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 480 }, children: [new TextRun({ text: '작성일: 2026년 5월 28일', size: 22, italics: true })] }),

        new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('Phase 5: 휴가 승인 워크플로우 이메일 통합')] }),
        new Paragraph({ spacing: { after: 120 }, children: [new TextRun('예상 소요: 2-2.5시간')] }),

        new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun('5.1 이메일 함수 추가')] }),
        new Paragraph({ spacing: { after: 120 }, numbering: { reference: 'bullets', level: 0 }, children: [new TextRun('sendLeaveApprovalRequest(): 승인자에게 휴가 승인 요청 알림')] }),
        new Paragraph({ spacing: { after: 120 }, numbering: { reference: 'bullets', level: 0 }, children: [new TextRun('sendLeaveApprovalCompletion(): 신청자에게 승인 완료 알림')] }),
        new Paragraph({ spacing: { after: 240 }, numbering: { reference: 'bullets', level: 0 }, children: [new TextRun('sendLeaveRejectionNotification(): 신청자에게 반려 알림')] }),

        new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun('5.2 휴가 API 통합')] }),
        new Paragraph({ spacing: { after: 120 }, numbering: { reference: 'bullets', level: 0 }, children: [new TextRun('휴가 신청 생성 시 첫 번째 승인자에게 알림')] }),
        new Paragraph({ spacing: { after: 120 }, numbering: { reference: 'bullets', level: 0 }, children: [new TextRun('각 승인 단계 완료 후 다음 승인자에게 알림')] }),
        new Paragraph({ spacing: { after: 240 }, numbering: { reference: 'bullets', level: 0 }, children: [new TextRun('최종 승인/반려 후 신청자에게 알림')] }),

        new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun('5.3 HTML 이메일 템플릿')] }),
        new Paragraph({ spacing: { after: 120 }, numbering: { reference: 'bullets', level: 0 }, children: [new TextRun('leaveApprovalRequest.html: 휴가 승인 요청')] }),
        new Paragraph({ spacing: { after: 120 }, numbering: { reference: 'bullets', level: 0 }, children: [new TextRun('leaveApprovalCompletion.html: 승인 완료')] }),
        new Paragraph({ spacing: { after: 240 }, numbering: { reference: 'bullets', level: 0 }, children: [new TextRun('leaveRejectionNotification.html: 반려 알림')] }),

        new Paragraph({ children: [new PageBreak()] }),

        new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('Phase 6: 직원관리 기능 확대')] }),
        new Paragraph({ spacing: { after: 120 }, children: [new TextRun('예상 소요: 4-5시간')] }),

        new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun('6.1 퇴사 처리 기능')] }),
        new Paragraph({ spacing: { after: 120 }, numbering: { reference: 'bullets', level: 0 }, children: [new TextRun('직원을 삭제하지 않고 퇴사 상태로 변경')] }),
        new Paragraph({ spacing: { after: 120 }, numbering: { reference: 'bullets', level: 0 }, children: [new TextRun('퇴사일, 퇴사사유 기록')] }),
        new Paragraph({ spacing: { after: 120 }, numbering: { reference: 'bullets', level: 0 }, children: [new TextRun('employmentStatus 상태 관리')] }),
        new Paragraph({ spacing: { after: 240 }, numbering: { reference: 'bullets', level: 0 }, children: [new TextRun('API: PATCH /api/employees/[id]/resign')] }),

        new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun('6.2 재직자 현황 대시보드')] }),
        new Paragraph({ spacing: { after: 120 }, numbering: { reference: 'bullets', level: 0 }, children: [new TextRun('월별/연별 재직자 현황 조회')] }),
        new Paragraph({ spacing: { after: 120 }, numbering: { reference: 'bullets', level: 0 }, children: [new TextRun('직급별 인원 분포')] }),
        new Paragraph({ spacing: { after: 120 }, numbering: { reference: 'bullets', level: 0 }, children: [new TextRun('지점별 세부 현황')] }),
        new Paragraph({ spacing: { after: 240 }, numbering: { reference: 'bullets', level: 0 }, children: [new TextRun('API: GET /api/employees/stats/active')] }),

        new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun('6.3 퇴직자 현황 대시보드')] }),
        new Paragraph({ spacing: { after: 120 }, numbering: { reference: 'bullets', level: 0 }, children: [new TextRun('월별/연간 퇴사자 통계')] }),
        new Paragraph({ spacing: { after: 120 }, numbering: { reference: 'bullets', level: 0 }, children: [new TextRun('직급별 구분')] }),
        new Paragraph({ spacing: { after: 120 }, numbering: { reference: 'bullets', level: 0 }, children: [new TextRun('월 클릭 시 상세 퇴사자 목록')] }),
        new Paragraph({ spacing: { after: 240 }, numbering: { reference: 'bullets', level: 0 }, children: [new TextRun('API: GET /api/employees/stats/resigned')] }),

        new Paragraph({ children: [new PageBreak()] }),

        new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('Phase 7: 계약서 고급 기능')] }),
        new Paragraph({ spacing: { after: 120 }, children: [new TextRun('예상 소요: 2-3일')] }),

        new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun('7.1 계약서 템플릿')] }),
        new Paragraph({ spacing: { after: 120 }, numbering: { reference: 'bullets', level: 0 }, children: [new TextRun('재사용 가능한 계약서 템플릿 저장')] }),
        new Paragraph({ spacing: { after: 120 }, numbering: { reference: 'bullets', level: 0 }, children: [new TextRun('템플릿별 기본 승인자 설정')] }),
        new Paragraph({ spacing: { after: 240 }, numbering: { reference: 'bullets', level: 0 }, children: [new TextRun('API: GET/POST/PATCH /api/contract-templates')] }),

        new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun('7.2 계약서 버전 관리')] }),
        new Paragraph({ spacing: { after: 120 }, numbering: { reference: 'bullets', level: 0 }, children: [new TextRun('계약서 수정 시 자동 버전 생성')] }),
        new Paragraph({ spacing: { after: 120 }, numbering: { reference: 'bullets', level: 0 }, children: [new TextRun('버전 히스토리 조회')] }),
        new Paragraph({ spacing: { after: 240 }, numbering: { reference: 'bullets', level: 0 }, children: [new TextRun('버전별 파일 다운로드')] }),

        new Paragraph({ children: [new PageBreak()] }),

        new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('Phase 8: 모바일 앱 개발 (Expo React Native)')] }),
        new Paragraph({ spacing: { after: 120 }, children: [new TextRun('예상 소요: 5-7일')] }),

        new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun('8.1 계약서 서명 화면 (우선순위 1)')] }),
        new Paragraph({ spacing: { after: 120 }, numbering: { reference: 'bullets', level: 0 }, children: [new TextRun('내 서명 대기 계약서 목록')] }),
        new Paragraph({ spacing: { after: 120 }, numbering: { reference: 'bullets', level: 0 }, children: [new TextRun('내 승인 대기 계약서 목록')] }),
        new Paragraph({ spacing: { after: 120 }, numbering: { reference: 'bullets', level: 0 }, children: [new TextRun('PDF 미리보기')] }),
        new Paragraph({ spacing: { after: 240 }, numbering: { reference: 'bullets', level: 0 }, children: [new TextRun('서명 및 제출')] }),

        new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun('8.2 출퇴근 화면 (우선순위 2)')] }),
        new Paragraph({ spacing: { after: 120 }, numbering: { reference: 'bullets', level: 0 }, children: [new TextRun('출근/퇴근 버튼')] }),
        new Paragraph({ spacing: { after: 120 }, numbering: { reference: 'bullets', level: 0 }, children: [new TextRun('GPS 위치 자동 수집')] }),
        new Paragraph({ spacing: { after: 120 }, numbering: { reference: 'bullets', level: 0 }, children: [new TextRun('지오펜스 확인')] }),
        new Paragraph({ spacing: { after: 240 }, numbering: { reference: 'bullets', level: 0 }, children: [new TextRun('출퇴근 기록 및 월간 통계')] }),

        new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun('8.3 휴가 신청 화면 (우선순위 3)')] }),
        new Paragraph({ spacing: { after: 120 }, numbering: { reference: 'bullets', level: 0 }, children: [new TextRun('휴가 유형 선택')] }),
        new Paragraph({ spacing: { after: 120 }, numbering: { reference: 'bullets', level: 0 }, children: [new TextRun('날짜 선택')] }),
        new Paragraph({ spacing: { after: 120 }, numbering: { reference: 'bullets', level: 0 }, children: [new TextRun('사유 입력')] }),
        new Paragraph({ spacing: { after: 240 }, numbering: { reference: 'bullets', level: 0 }, children: [new TextRun('신청 및 현황 추적')] }),

        new Paragraph({ children: [new PageBreak()] }),

        new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('Phase 9: 클라우드 배포')] }),
        new Paragraph({ spacing: { after: 120 }, children: [new TextRun('예상 소요: 1-2일')] }),

        new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun('9.1 Vercel 배포')] }),
        new Paragraph({ spacing: { after: 120 }, numbering: { reference: 'bullets', level: 0 }, children: [new TextRun('Next.js 웹 애플리케이션 배포')] }),
        new Paragraph({ spacing: { after: 120 }, numbering: { reference: 'bullets', level: 0 }, children: [new TextRun('자동 빌드 및 배포 설정')] }),
        new Paragraph({ spacing: { after: 240 }, numbering: { reference: 'bullets', level: 0 }, children: [new TextRun('환경 변수 관리')] }),

        new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun('9.2 데이터베이스 (Supabase/AWS RDS)')] }),
        new Paragraph({ spacing: { after: 120 }, numbering: { reference: 'bullets', level: 0 }, children: [new TextRun('PostgreSQL 클라우드 마이그레이션')] }),
        new Paragraph({ spacing: { after: 120 }, numbering: { reference: 'bullets', level: 0 }, children: [new TextRun('백업 및 복구 설정')] }),
        new Paragraph({ spacing: { after: 240 }, numbering: { reference: 'bullets', level: 0 }, children: [new TextRun('보안 설정 및 접근 제어')] }),

        new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('Phase 10: 추가 기능')] }),

        new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun('10.1 급여 관리')] }),
        new Paragraph({ spacing: { after: 120 }, numbering: { reference: 'bullets', level: 0 }, children: [new TextRun('기본급, 수당, 공제 항목 관리')] }),
        new Paragraph({ spacing: { after: 240 }, numbering: { reference: 'bullets', level: 0 }, children: [new TextRun('월급 지급 및 급여명세서 발급')] }),

        new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun('10.2 인사평가')] }),
        new Paragraph({ spacing: { after: 120 }, numbering: { reference: 'bullets', level: 0 }, children: [new TextRun('평가 항목 및 등급 관리')] }),
        new Paragraph({ spacing: { after: 240 }, numbering: { reference: 'bullets', level: 0 }, children: [new TextRun('연간 평가 추적')] }),

        new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun('10.3 조직도')] }),
        new Paragraph({ spacing: { after: 120 }, numbering: { reference: 'bullets', level: 0 }, children: [new TextRun('부서별 조직 구조 시각화')] }),
        new Paragraph({ spacing: { after: 240 }, numbering: { reference: 'bullets', level: 0 }, children: [new TextRun('보고 관계 표시')] })
      ]
    }]
  });

  Packer.toBuffer(doc2).then(buffer => {
    fs.writeFileSync('Shiftee_Project_Roadmap.docx', buffer);
    console.log('✓ Project roadmap document created!');
    console.log('\n두 문서가 C:\\shiftee 디렉토리에 생성되었습니다:');
    console.log('  1. Shiftee_Implementation_Summary.docx');
    console.log('  2. Shiftee_Project_Roadmap.docx');
  });
});
