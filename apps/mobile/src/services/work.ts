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
// XHR 사용: RN의 fetch가 XHR 위에 구현돼 있어 FormData multipart boundary 처리는 동일하게 안전하고,
// XHR만 업로드 진행률(onprogress) 이벤트를 지원한다. (Content-Type 지정 금지 → boundary 포함해 자동 설정)
export async function uploadFile(
  file: { uri: string; name: string; mimeType?: string | null },
  onProgress?: (percent: number) => void
) {
  const form = new FormData();
  form.append("file", { uri: file.uri, name: file.name, type: file.mimeType || "application/octet-stream" } as any);
  const headers = (await authHeaders()) as Record<string, string>;
  return await new Promise<{ fileUrl: string; fileName: string; fileType: string }>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_URL}/work/upload`);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      try {
        const j = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300) resolve(j);
        else reject(new Error(j?.error || `업로드 실패 (${xhr.status})`));
      } catch {
        reject(new Error(`업로드 실패 (${xhr.status})`));
      }
    };
    xhr.onerror = () => reject(new Error("네트워크 오류 또는 파일을 읽을 수 없어 업로드에 실패했습니다."));
    // 무한 대기 방지 — 응답 없는 연결로 전송 버튼이 영구 잠기지 않게 (대용량 영상 감안 5분)
    xhr.timeout = 300000;
    xhr.ontimeout = () => reject(new Error("업로드 시간이 초과되었습니다. 네트워크 상태를 확인해주세요."));
    xhr.send(form as any);
  });
}

// 프로필 사진 업로드 → { avatarUrl }
export async function uploadAvatar(file: { uri: string; name: string; mimeType?: string | null }) {
  const form = new FormData();
  form.append("file", { uri: file.uri, name: file.name, type: file.mimeType || "image/jpeg" } as any);
  const res = await fetch(`${API_URL}/me/avatar`, {
    method: "POST",
    headers: { ...(await authHeaders()) } as Record<string, string>,
    body: form,
  });
  if (!res.ok) {
    let msg = `업로드 실패 (${res.status})`;
    try { const j = await res.json(); if (j?.error) msg = j.error; } catch {}
    throw new Error(msg);
  }
  return (await res.json()) as { avatarUrl: string };
}

// 텍스트 메시지 전송 (인용 답장 replyToId 선택)
export async function sendTextMessage(channelId: string, content: string, replyToId?: string | null) {
  const res = await axios.post(
    `${API_URL}/work/channels/${channelId}/messages`,
    { content, replyToId: replyToId ?? null },
    { headers: await authHeaders() }
  );
  return res.data?.message;
}

// 예약 전송
export type ScheduledItem = { id: string; content: string; sendAt: string };
export async function createScheduledMessage(channelId: string, content: string, sendAt: string) {
  await axios.post(`${API_URL}/work/channels/${channelId}/scheduled`, { content, sendAt }, { headers: await authHeaders() });
}
export async function getScheduledMessages(channelId: string): Promise<ScheduledItem[]> {
  const res = await axios.get(`${API_URL}/work/channels/${channelId}/scheduled`, { headers: await authHeaders() });
  return (res.data?.scheduled as ScheduledItem[]) || [];
}
export async function cancelScheduledMessage(id: string) {
  await axios.delete(`${API_URL}/work/scheduled/${id}`, { headers: await authHeaders() });
}

// 메시지 리마인더 등록 (도래 시 봇 DM)
export async function createReminder(messageId: string, remindAt: string) {
  await axios.post(`${API_URL}/work/messages/${messageId}/reminder`, { remindAt }, { headers: await authHeaders() });
}

// 북마크 토글 (개인 보관함)
export async function toggleBookmark(messageId: string): Promise<boolean> {
  const res = await axios.post(`${API_URL}/work/messages/${messageId}/bookmark`, {}, { headers: await authHeaders() });
  return !!res.data?.bookmarked;
}

// 내 보관함 목록
export type SavedItem = {
  messageId: string; channelId: string; channelName: string; userName: string;
  content: string; fileUrl?: string | null; fileName?: string | null; fileType?: string | null; createdAt: string;
};
export async function getBookmarks(): Promise<SavedItem[]> {
  const res = await axios.get(`${API_URL}/work/bookmarks`, { headers: await authHeaders() });
  return (res.data?.bookmarks as SavedItem[]) || [];
}

// 나를 멘션한 메시지 모아보기
export async function getMentions(): Promise<SavedItem[]> {
  const res = await axios.get(`${API_URL}/work/mentions`, { headers: await authHeaders() });
  return (res.data?.mentions as SavedItem[]) || [];
}

// 메시지 전달 (내용/첨부/앨범/표시순서 그대로 다른 채널로)
export async function forwardMessage(
  channelId: string,
  m: { content: string; fileUrl?: string | null; fileName?: string | null; fileType?: string | null; albumUrls?: string[] | null; attachFirst?: boolean }
) {
  await axios.post(
    `${API_URL}/work/channels/${channelId}/messages`,
    { content: m.content, fileUrl: m.fileUrl ?? null, fileName: m.fileName ?? null, fileType: m.fileType ?? null, albumUrls: m.albumUrls ?? undefined, attachFirst: !!m.attachFirst },
    { headers: await authHeaders() }
  );
}

// 사진 앨범(여러 장 묶음) 전송 — 글(캡션)·작성순서·답장 함께 가능
export async function sendAlbumMessage(
  channelId: string,
  albumUrls: string[],
  opts?: { content?: string; attachFirst?: boolean; replyToId?: string }
) {
  const res = await axios.post(
    `${API_URL}/work/channels/${channelId}/messages`,
    { content: opts?.content ?? "", albumUrls, attachFirst: !!opts?.attachFirst, replyToId: opts?.replyToId ?? null },
    { headers: await authHeaders() }
  );
  return res.data?.message;
}

// 메시지 읽음/안읽음 멤버 명단
export type ReaderEntry = { userId: string; name: string; branch: string | null; avatarUrl: string | null };
export async function getMessageReaders(messageId: string): Promise<{ read: ReaderEntry[]; unread: ReaderEntry[] }> {
  const res = await axios.get(`${API_URL}/work/messages/${messageId}/readers`, { headers: await authHeaders() });
  return res.data as { read: ReaderEntry[]; unread: ReaderEntry[] };
}

// 메시지 삭제(되돌리기) — 본인만
export async function deleteMessage(messageId: string) {
  await axios.delete(`${API_URL}/work/messages/${messageId}`, { headers: await authHeaders() });
}

// 메시지 수정 — 본인만
export async function editMessage(messageId: string, content: string) {
  await axios.patch(`${API_URL}/work/messages/${messageId}`, { content }, { headers: await authHeaders() });
}

// 업로드된 첨부를 메시지로 전송 — 글(캡션)·작성순서·답장 함께 가능
export async function sendFileMessage(
  channelId: string,
  file: { fileUrl: string; fileName: string; fileType: string },
  opts?: { content?: string; attachFirst?: boolean; replyToId?: string }
) {
  const res = await axios.post(
    `${API_URL}/work/channels/${channelId}/messages`,
    { content: opts?.content ?? "", ...file, attachFirst: !!opts?.attachFirst, replyToId: opts?.replyToId ?? null },
    { headers: await authHeaders() }
  );
  return res.data?.message;
}

// 리액션 토글 (같은 이모지 다시 누르면 제거)
export async function toggleReaction(messageId: string, emoji: string) {
  await axios.post(`${API_URL}/work/messages/${messageId}/reactions`, { emoji }, { headers: await authHeaders() });
}

// 공지 작성 (관리자 전용 — 서버에서 권한 검증)
// 내 알림 설정 (결재 결과 알림 수신 여부)
export async function getNotifySettings(): Promise<{ notifyApproval: boolean; forced: boolean }> {
  const res = await axios.get(`${API_URL}/me/notify`, { headers: await authHeaders() });
  return { notifyApproval: !!res.data?.notifyApproval, forced: !!res.data?.forced };
}
export async function setNotifyApproval(on: boolean) {
  await axios.patch(`${API_URL}/me/notify`, { notifyApproval: on }, { headers: await authHeaders() });
}

// 공지 핀 고정/해제 (관리자)
export async function pinAnnouncement(id: string, pinned: boolean) {
  await axios.patch(`${API_URL}/work/announcements/${id}`, { pinned }, { headers: await authHeaders() });
}

// 공지 삭제 (관리자)
export async function deleteAnnouncement(id: string) {
  await axios.delete(`${API_URL}/work/announcements/${id}`, { headers: await authHeaders() });
}

export async function createAnnouncement(data: {
  title: string;
  content: string;
  pinned?: boolean;
  attachments?: { url: string; name: string; type: string }[];
}) {
  await axios.post(`${API_URL}/work/announcements`, data, { headers: await authHeaders() });
}
