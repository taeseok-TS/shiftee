import { EventEmitter } from "events";

// HMR/멀티 import 에도 단일 인스턴스 유지 (dev 단일 프로세스 기준)
const g = globalThis as unknown as { __workBus?: EventEmitter };
export const workBus: EventEmitter = g.__workBus ?? (g.__workBus = new EventEmitter());
workBus.setMaxListeners(0);

export type WorkEvent =
  | { type: "message"; channelId: string }
  | { type: "reaction"; channelId: string }
  | { type: "read"; channelId: string }
  | { type: "typing"; channelId: string; userId: string; userName: string };

// 컨텐츠는 싣지 않고 신호만 보냄 (DM 내용 유출 방지 → 클라이언트가 재조회)
export function emitWork(event: WorkEvent) {
  workBus.emit("event", event);
}
