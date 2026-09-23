"use client";

// 직영(큐브티 본사) 주소인지 — 화면에서 쓰는 훅. 판별 규칙 자체는 lib/is-direct-host 하나뿐이다
// (서버 컴포넌트는 이 파일이 "use client" 라 못 쓰므로 그쪽 모듈을 직접 부른다).
import { useSyncExternalStore } from "react";
import { isDirectHost } from "@/lib/is-direct-host";

const noopSubscribe = () => () => {};
const isDirect = () => isDirectHost(window.location.host);

/** 서버 렌더에서는 false — 고객사 화면에 직영 문구가 잠깐이라도 스치지 않게. */
export function useIsDirectHost(): boolean {
  return useSyncExternalStore(noopSubscribe, isDirect, () => false);
}
