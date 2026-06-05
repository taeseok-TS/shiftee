import * as XLSX from 'xlsx';

export interface EmployeeData {
  직원명: string;
  직급: string;
  직군: string;
  지점: string;
  입사일: string;
  상태: string;
  퇴사일?: string;
  퇴사사유?: string;
}

/**
 * 재직자 현황을 엑셀로 다운로드
 */
export function downloadActiveEmployeesExcel(data: any, period: string, dateStr: string) {
  const sheet_data: EmployeeData[] = [];

  // 헤더 및 데이터 구성
  if (data.employees && Array.isArray(data.employees)) {
    (data.employees || []).forEach((emp: any) => {
      sheet_data.push({
        직원명: emp.name,
        직급: emp.jobGroup || '-',
        직군: emp.position || '-',
        지점: emp.branch || '-',
        입사일: emp.hireDate ? new Date(emp.hireDate).toLocaleDateString('ko-KR') : '-',
        상태: 'ACTIVE',
      });
    });
  }

  const ws = XLSX.utils.json_to_sheet(sheet_data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '재직자');

  // 스타일 설정
  ws['!cols'] = [
    { wch: 15 }, // 직원명
    { wch: 12 }, // 직급
    { wch: 12 }, // 직군
    { wch: 15 }, // 지점
    { wch: 15 }, // 입사일
    { wch: 10 }, // 상태
  ];

  const fileName = `재직자현황_${dateStr}_${new Date().toISOString().split('T')[0]}.xlsx`;
  XLSX.writeFile(wb, fileName);
}

/**
 * 퇴직자 현황을 엑셀로 다운로드
 */
export function downloadResignedEmployeesExcel(data: any, periodType: string, dateStr: string) {
  const sheet_data: EmployeeData[] = [];

  if (data.employees && Array.isArray(data.employees)) {
    // 월간 조회
    (data.employees || []).forEach((emp: any) => {
      sheet_data.push({
        직원명: emp.name,
        직급: emp.jobGroup || '-',
        직군: emp.position || '-',
        지점: emp.branch || '-',
        입사일: emp.hireDate ? new Date(emp.hireDate).toLocaleDateString('ko-KR') : '-',
        상태: 'RESIGNED',
        퇴사일: emp.resignDate ? new Date(emp.resignDate).toLocaleDateString('ko-KR') : '-',
        퇴사사유: emp.resignReason || '-',
      });
    });
  }

  const ws = XLSX.utils.json_to_sheet(sheet_data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '퇴직자');

  ws['!cols'] = [
    { wch: 15 }, // 직원명
    { wch: 12 }, // 직급
    { wch: 12 }, // 직군
    { wch: 15 }, // 지점
    { wch: 15 }, // 입사일
    { wch: 10 }, // 상태
    { wch: 15 }, // 퇴사일
    { wch: 20 }, // 퇴사사유
  ];

  const fileName = `퇴직자현황_${dateStr}_${new Date().toISOString().split('T')[0]}.xlsx`;
  XLSX.writeFile(wb, fileName);
}

/**
 * 연간 퇴직자 현황 요약 다운로드
 */
export function downloadResignedSummaryExcel(data: any, year: string) {
  const summaryData: any[] = [];

  // 월별 통계
  if (data.byMonth && typeof data.byMonth === 'object') {
    (Object.entries(data.byMonth) || []).forEach(([month, counts]: [string, any]) => {
      summaryData.push({
        월: month,
        '전체퇴직자': counts.total,
        '원장': counts['원장'] || 0,
        'CM': counts.CM || 0,
        'TM': counts.TM || 0,
        '코디': counts['코디'] || 0,
      });
    });
  }

  const ws = XLSX.utils.json_to_sheet(summaryData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, `${year}년 월별통계`);

  ws['!cols'] = [
    { wch: 12 }, // 월
    { wch: 12 }, // 전체퇴직자
    { wch: 10 }, // 원장
    { wch: 10 }, // CM
    { wch: 10 }, // TM
    { wch: 10 }, // 코디
  ];

  const fileName = `퇴직자현황요약_${year}년_${new Date().toISOString().split('T')[0]}.xlsx`;
  XLSX.writeFile(wb, fileName);
}
