import { EventEmitter } from "events";

// HMR/멀티 import 에도 단일 인스턴스 유지 (dev 단일 프로세스 기준)
const g = globalThis as unknown as { __workBus?: EventEmitter };
export const workBus: EventEmitter = g.__workBus ?? (g.__workBus = new EventEmitter());
workBus.setMaxListeners(0);

export type WorkEvent =
  | { type: "message"; channelId: string; senderId?: string } // senderId: 웹 데스크톱 알림에서 본인 메시지 제외용(내용은 싣지 않음)
  | { type: "reaction"; channelId: string }
  | { type: "read"; channelId: string }
  | { type: "typing"; channelId: string; userId: string; userName: string };

// 컨텐츠는 싣지 않고 신호만 보냄 (DM 내용 유출 방지 → 클라이언트가 재조회)
export function emitWork(event: WorkEvent) {
  workBus.emit("event", event);
}

// ── 타이핑 상태 (모바일 폴링용). 짧은 TTL 인메모리 저장 ──
// SSE를 못 쓰는 모바일이 GET /typing 으로 조회한다.
const TYPING_TTL = 4000; // ms
type TypingStore = Map<string, Map<string, { name: string; at: number }>>;
const gt = globalThis as unknown as { __workTyping?: TypingStore };
const typingStore: TypingStore = gt.__workTyping ?? (gt.__workTyping = new Map());

export function setTyping(channelId: string, userId: string, name: string, now: number) {
  let ch = typingStore.get(channelId);
  if (!ch) { ch = new Map(); typingStore.set(channelId, ch); }
  ch.set(userId, { name, at: now });
}

// 최근 TTL 이내 타이핑 중인 사용자 이름들 (본인 제외)
export function getTyping(channelId: string, excludeUserId: string, now: number): string[] {
  const ch = typingStore.get(channelId);
  if (!ch) return [];
  const names: string[] = [];
  for (const [uid, v] of ch) {
    if (now - v.at > TYPING_TTL) { ch.delete(uid); continue; }
    if (uid !== excludeUserId) names.push(v.name);
  }
  return names;
}
