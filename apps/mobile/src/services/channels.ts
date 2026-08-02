/**
 * ============================================
 * 큐브티 Mobile - 채널/DM 생성 서비스
 * ============================================
 */

import axios from "axios";
import { API_URL } from "../config";
import { getToken } from "./storage";

async function authHeaders() {
  const token = await getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export type Member = {
  id: string;
  name: string;
  department?: string | null;
  branch?: string | null;
  position?: string | null;
  role?: string | null;
};

// 채팅 대상자 목록 (전 직원 + 관리자·서브관리자, 회사 전체). 기본엔 관리자 숨기고 검색 시 노출은 화면에서 처리.
export async function getMembers(): Promise<Member[]> {
  const res = await axios.get(`${API_URL}/work/members`, { headers: await authHeaders() });
  return (res.data?.members as Member[]) || [];
}

export async function createChannel(params: {
  name?: string;
  type: "CHANNEL" | "DM";
  memberIds: string[];
}): Promise<{ id: string; name: string; type: string }> {
  const res = await axios.post(`${API_URL}/work/channels`, params, { headers: await authHeaders() });
  return res.data?.channel;
}

// 채널에 멤버 추가
export async function addChannelMembers(channelId: string, userIds: string[]) {
  await axios.post(`${API_URL}/work/channels/${channelId}/members`, { userIds }, { headers: await authHeaders() });
}

// 현재 채널 멤버 id 목록 (이미 들어간 사람 제외용)
export async function getChannelMemberIds(channelId: string): Promise<string[]> {
  const res = await axios.get(`${API_URL}/work/channels/${channelId}/members`, { headers: await authHeaders() });
  const members = res.data?.members ?? [];
  return members.map((m: any) => m.userId ?? m.user?.id ?? m.id).filter(Boolean);
}

// 현재 채널 멤버(이름 포함) — @멘션 자동완성용
export type ChannelMemberInfo = { userId: string; name: string; branch?: string | null };
export async function getChannelMembersList(channelId: string): Promise<ChannelMemberInfo[]> {
  const res = await axios.get(`${API_URL}/work/channels/${channelId}/members`, { headers: await authHeaders() });
  return ((res.data?.members ?? []) as any[]).map((m) => ({ userId: m.userId, name: m.name, branch: m.branch }));
}

// 채팅방 이름 변경 (방장/관리자 — 서버가 권한 검증, 변경 시 시스템 메시지 자동 생성)
export async function renameChannel(channelId: string, name: string) {
  await axios.patch(`${API_URL}/work/channels/${channelId}`, { name }, { headers: await authHeaders() });
}

// 채널 삭제 (방장/관리자 — 채널 자체 삭제)
export async function deleteChannel(channelId: string) {
  await axios.delete(`${API_URL}/work/channels/${channelId}`, { headers: await authHeaders() });
}

// 채널 나가기 (일반 멤버 — 본인만 제거)
export async function leaveChannel(channelId: string, userId: string) {
  await axios.delete(`${API_URL}/work/channels/${channelId}/members`, { headers: await authHeaders(), data: { userId } });
}

// DM 나만 숨기기 (상대에겐 영향 없음, 새 메시지 오면 다시 표시)
export async function hideChannel(channelId: string) {
  await axios.post(`${API_URL}/work/channels/${channelId}/hide`, {}, { headers: await authHeaders() });
}

// 미확인(신규) 메시지 총 개수 (메신저 탭 배지)
export async function getUnreadCount(): Promise<number> {
  const res = await axios.get(`${API_URL}/work/unread`, { headers: await authHeaders() });
  return (res.data?.total as number) || 0;
}

// 타이핑 신호 보내기
export async function postTyping(channelId: string) {
  await axios.post(`${API_URL}/work/channels/${channelId}/typing`, {}, { headers: await authHeaders() });
}

// 현재 타이핑 중인 사용자 이름들(본인 제외)
export async function getTypingUsers(channelId: string): Promise<string[]> {
  const res = await axios.get(`${API_URL}/work/channels/${channelId}/typing`, { headers: await authHeaders() });
  return (res.data?.typing as string[]) || [];
}

// 링크 미리보기 (OG 메타). 모듈 캐시로 중복 조회 방지.
export type LinkPreviewData = { url: string; title: string | null; description: string | null; image: string | null; siteName: string | null } | null;
const linkPreviewCache = new Map<string, LinkPreviewData>();
export async function getLinkPreview(url: string): Promise<LinkPreviewData> {
  if (linkPreviewCache.has(url)) return linkPreviewCache.get(url)!;
  try {
    const res = await axios.get(`${API_URL}/work/link-preview`, { params: { url }, headers: await authHeaders() });
    const p = (res.data?.preview ?? null) as LinkPreviewData;
    linkPreviewCache.set(url, p);
    return p;
  } catch {
    linkPreviewCache.set(url, null);
    return null;
  }
}

// 채널 고정 공지 등록/내리기 (이미지 메시지는 imageUrl로 이미지 공지, important=중요 공지)
export async function setChannelNotice(channelId: string, content: string, imageUrl?: string | null, important?: boolean) {
  await axios.post(
    `${API_URL}/work/channels/${channelId}/notice`,
    { content, imageUrl: imageUrl ?? null, important: !!important },
    { headers: await authHeaders() }
  );
}

// 공지 확인/미확인 멤버 명단
export async function getNoticeReaders(channelId: string): Promise<{ read: any[]; unread: any[] }> {
  const res = await axios.get(`${API_URL}/work/channels/${channelId}/notice/readers`, { headers: await authHeaders() });
  return res.data;
}
export async function clearChannelNotice(channelId: string) {
  await axios.delete(`${API_URL}/work/channels/${channelId}/notice`, { headers: await authHeaders() });
}

// 채널 내 공유 링크 모아보기
export type SharedLink = { url: string; userName: string; createdAt: string };
export async function getChannelLinks(channelId: string): Promise<SharedLink[]> {
  const res = await axios.get(`${API_URL}/work/channels/${channelId}/links`, { headers: await authHeaders() });
  return (res.data?.links as SharedLink[]) || [];
}

// 투표: 생성 / 투표(토글) / 마감
export async function createPoll(channelId: string, data: { question: string; options: string[]; multiple: boolean; closesAt?: string }) {
  await axios.post(`${API_URL}/work/channels/${channelId}/polls`, data, { headers: await authHeaders() });
}
export async function votePoll(pollId: string, optionIndex: number) {
  await axios.post(`${API_URL}/work/polls/${pollId}`, { optionIndex }, { headers: await authHeaders() });
}
export async function closePoll(pollId: string) {
  await axios.patch(`${API_URL}/work/polls/${pollId}`, {}, { headers: await authHeaders() });
}

// 채널 알림 설정 (ALL=받음, MUTE=안받음)
export async function setChannelNotify(channelId: string, notify: "ALL" | "MENTION" | "MUTE") {
  await axios.patch(`${API_URL}/work/channels/${channelId}/notify`, { notify }, { headers: await authHeaders() });
}

// 채널 상단 고정/해제 (사용자별 — 목록 정렬은 서버가 핀 우선)
export async function setChannelPin(channelId: string, pinned: boolean) {
  await axios.post(`${API_URL}/work/channels/${channelId}/pin`, { pinned }, { headers: await authHeaders() });
}

// 큐브티워크 채팅 알림 전체 끄기 — 메시지는 수신하되 푸시만 차단
export async function getWorkMuteAll(): Promise<boolean> {
  const res = await axios.get(`${API_URL}/me/notify`, { headers: await authHeaders() });
  return !!res.data?.workMuteAll;
}
export async function setWorkMuteAll(on: boolean) {
  await axios.patch(`${API_URL}/me/notify`, { workMuteAll: on }, { headers: await authHeaders() });
}
