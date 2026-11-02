// 재무팀 「전자계약 열람 전용」 계정 (2026-11-02 디렉터 회의 5번 「재무팀에 전달할 별도 계정 — 전 직원 전자계약만 확인」)
//
// 계정은 **직원(EMPLOYEE) 역할 · 본부 소속**으로 만든다 — 관리자 권한을 주면 관리자 API 수백 곳이 다 열린다.
// 그 위에 이 목록에 든 계정만 다음을 더 할 수 있다:
//   · 전 직원 계약서 목록(api/finance/contracts) · 완료본/진행본 PDF 보기 · 받기(api/contracts/[id]/signed-document — 디렉터 결정 「열람 + PDF 받기」)
//   · 보내기 · 결재 · 고치기 · 지우기는 없다(그 API 들은 여전히 관리자 · 결재자만).
// 화면은 /finance/contracts 하나 — 직원 화면((dashboard)) · 큐브티워크(work)로 들어오면 그리로 보낸다. 자료제출 대상에서도 뺀다.
//
// 스키마는 바꾸지 않는다. AppSetting `contractViewers`(JSON 배열 또는 쉼표 구분 — 계정 id). lib/employee-scope testAccounts 와 같은 관례.
import { prisma } from "@/lib/db";

export const CONTRACT_VIEWERS_KEY = "contractViewers";
const TTL_MS = 60_000;
let cache: { at: number; ids: string[] } | null = null;

/** 열람 전용 계정 id 목록 — 설정을 못 읽으면 빈 목록(아무에게도 권한을 주지 않는 쪽으로 실패) */
export async function contractViewerIds(): Promise<string[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.ids;
  let ids: string[] = [];
  try {
    const row = await prisma.appSetting.findUnique({ where: { key: CONTRACT_VIEWERS_KEY } });
    const v = row?.value?.trim();
    if (v) {
      let parsed: unknown;
      try { parsed = JSON.parse(v); } catch { parsed = v.split(","); }
      ids = (Array.isArray(parsed) ? parsed : [parsed]).filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean);
    }
  } catch (e) {
    console.error("[contract-viewer] 설정 읽기 실패:", e instanceof Error ? e.message : e);
    return cache?.ids ?? [];
  }
  cache = { at: Date.now(), ids };
  return ids;
}

/** 이 세션이 열람 전용 계정인가 — 관리자 · 원장 계정은 목록에 있어도 아니다(역할이 바뀌면 이 권한도 끝난다) */
export async function isContractViewer(session: { userId: string; role: string } | null | undefined): Promise<boolean> {
  if (!session || session.role !== "EMPLOYEE") return false;
  return (await contractViewerIds()).includes(session.userId);
}
