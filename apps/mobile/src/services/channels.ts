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
