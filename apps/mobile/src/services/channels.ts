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
};

// 멤버 선택용 직원 목록 (관리자 제외, MANAGER는 자기 지점만 — 서버 정책)
export async function getMembers(): Promise<Member[]> {
  const res = await axios.get(`${API_URL}/employees`, { headers: await authHeaders() });
  return (res.data?.employees as Member[]) || [];
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

// 채널 삭제 (방장/관리자 — 채널 자체 삭제)
export async function deleteChannel(channelId: string) {
  await axios.delete(`${API_URL}/work/channels/${channelId}`, { headers: await authHeaders() });
}

// 채널 나가기 (일반 멤버 — 본인만 제거)
export async function leaveChannel(channelId: string, userId: string) {
  await axios.delete(`${API_URL}/work/channels/${channelId}/members`, { headers: await authHeaders(), data: { userId } });
}

// 채널 알림 설정 (ALL=받음, MUTE=안받음)
export async function setChannelNotify(channelId: string, notify: "ALL" | "MENTION" | "MUTE") {
  await axios.patch(`${API_URL}/work/channels/${channelId}/notify`, { notify }, { headers: await authHeaders() });
}
