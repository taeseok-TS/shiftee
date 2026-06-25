/**
 * ============================================
 * 큐브티 Mobile - 메신저 부가기능 (파일 업로드, 리액션)
 * ============================================
 */

import axios from "axios";
import { API_URL } from "../config";
import { getToken } from "./storage";

// 첨부파일 서빙 origin (fileUrl이 "/api/uploads/..." 상대경로로 옴)
export const FILE_ORIGIN = API_URL.replace(/\/api$/, "");

async function authHeaders() {
  const token = await getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// 파일 업로드 → { fileUrl, fileName, fileType("image"|"file") }
export async function uploadFile(file: { uri: string; name: string; mimeType?: string | null }) {
  const form = new FormData();
  form.append("file", { uri: file.uri, name: file.name, type: file.mimeType || "application/octet-stream" } as any);
  const res = await axios.post(`${API_URL}/work/upload`, form, {
    headers: { ...(await authHeaders()), "Content-Type": "multipart/form-data" },
  });
  return res.data as { fileUrl: string; fileName: string; fileType: string };
}

// 업로드된 첨부를 메시지로 전송
export async function sendFileMessage(
  channelId: string,
  file: { fileUrl: string; fileName: string; fileType: string }
) {
  const res = await axios.post(
    `${API_URL}/work/channels/${channelId}/messages`,
    { content: "", ...file },
    { headers: await authHeaders() }
  );
  return res.data?.message;
}

// 리액션 토글 (같은 이모지 다시 누르면 제거)
export async function toggleReaction(messageId: string, emoji: string) {
  await axios.post(`${API_URL}/work/messages/${messageId}/reactions`, { emoji }, { headers: await authHeaders() });
}
