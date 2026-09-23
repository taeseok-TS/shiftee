"use client";

// 직영(큐브티 본사) 주소인지 — 판매용 고객사 인스턴스도 같은 화면을 쓰기 때문에,
// 직영 전용 안내(직영 포털 링크, EMS 계정 안내 등)는 이 주소에서만 보여 준다.
// ⚠ 하위 주소 전체(*.cubetee.co.kr)로 보면 안 된다 — 고객사 기본 주소가 "회사명.cubetee.co.kr" 이다.
import { useSyncExternalStore } from "react";

const noopSubscribe = () => () => {};
const isDirect = () => /^(www\.)?cubetee\.co\.kr$/.test(window.location.hostname);

/** 서버 렌더에서는 false — 고객사 화면에 직영 문구가 잠깐이라도 스치지 않게. */
export function useIsDirectHost(): boolean {
  return useSyncExternalStore(noopSubscribe, isDirect, () => false);
}
