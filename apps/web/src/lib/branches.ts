// 기본 지점 A~O → 실제 지점명 매핑 (백업용)
export const defaultBranchMapping: Record<string, string> = {
  "A": "서울강남점",
  "B": "서울강북점",
  "C": "부산중앙점",
  "D": "인천연수점",
  "E": "대구중앙점",
  "F": "대전유성점",
  "G": "광주동구점",
  "H": "울산중구점",
  "I": "경기수원점",
  "J": "경기안산점",
  "K": "강원춘천점",
  "L": "충북청주점",
  "M": "전북전주점",
  "N": "경주점",
  "O": "제주점",
};

export const reverseBranchMapping: Record<string, string> =
  Object.fromEntries(Object.entries(defaultBranchMapping).map(([k, v]) => [v, k]));

/**
 * 구 지점명(A지점) 또는 신 지점명(서울강남점)을 신 지점명으로 변환
 * 이 함수는 서버 사이드 렌더링에서도 작동하도록 항상 동기적입니다.
 */
export function normalizeBranchName(branch: string | null | undefined): string | null {
  if (!branch) return null;

  // 이미 실제 지점명인 경우 (기본 매핑에 있으면 유효한 지점)
  if (Object.values(defaultBranchMapping).includes(branch)) {
    return branch;
  }

  // A지점 형식에서 매핑
  if (branch.endsWith("지점")) {
    const letter = branch.slice(0, -2);
    return defaultBranchMapping[letter] || null;
  }

  // 단순 A, B, C 등으로 매핑
  return defaultBranchMapping[branch.toUpperCase()] || null;
}

/**
 * 신 지점명을 구 지점명(A, B, C)으로 변환
 */
export function getBranchLetter(branchName: string | null | undefined): string | null {
  if (!branchName) return null;
  return reverseBranchMapping[branchName] || null;
}

/**
 * 모든 기본 지점 목록 반환 (정렬됨)
 * 주의: 이것은 하드코딩된 기본값입니다.
 * 실제 지점 목록은 getAllBranchesFromAPI를 사용하세요.
 */
export function getAllBranches(): Array<{ letter: string; name: string }> {
  return Object.entries(defaultBranchMapping)
    .map(([letter, name]) => ({ letter, name }))
    .sort((a, b) => a.letter.localeCompare(b.letter));
}

/**
 * 지점명 표시용 (A지점 → 서울강남점 변환)
 */
export function formatBranchName(branch: string | null | undefined): string {
  if (!branch) return "미지정";
  const normalized = normalizeBranchName(branch);
  return normalized || branch;
}
