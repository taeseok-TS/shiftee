/**
 * ============================================
 * 큐브티 Mobile - 자료제출 (2026-09-13 3단계)
 * 웹 api/work/submissions/* 를 그대로 부른다. 지점·직책·직급·연월은 서버가 채운다.
 * ============================================
 */
import axios from "axios";
import { API_URL } from "../config";
import { getToken } from "./storage";

async function authHeaders() {
  const token = await getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export type SubmissionFile = { url: string; name: string; size: number; type: string };
export type Category = { id: string; group: "EDU" | "PROMO" | "EVENT"; name: string; active: boolean };
export type SubmissionRequest = {
  id: string; title: string; description: string | null; categoryId: string; category?: { id: string; group: string; name: string };
  targetJobGroups: string[]; targetBranches: string[]; dueDate: string | null; createdByName: string; closedAt: string | null; createdAt: string;
  mySubmissionId?: string | null; mySubmittedAt?: string | null;
};
export type Submission = {
  id: string; requestId: string | null; request: { id: string; title: string; dueDate: string | null; closedAt?: string | null } | null;
  categoryId: string; category?: { id: string; group: string; name: string };
  userId: string; userName: string; userBranch: string | null; userJobGroup: string | null; userPosition: string | null;
  yearMonth: string; title: string; memo: string | null; files: SubmissionFile[]; status: "SUBMITTED" | "CHECKED";
  checkedAt: string | null; shared: boolean; shareJobGroups: string[]; createdAt: string;
};

export const CATEGORY_GROUP_LABEL: Record<string, string> = { EDU: "교육", PROMO: "본부 프로모션", EVENT: "본부 이벤트" };

export async function getCategories(): Promise<Category[]> {
  const res = await axios.get(`${API_URL}/work/submissions/categories`, { headers: await authHeaders() });
  return res.data.categories ?? [];
}

export async function getMyRequests(status: "open" | "closed" | "all" = "open"): Promise<SubmissionRequest[]> {
  const res = await axios.get(`${API_URL}/work/submissions/requests`, { params: { status }, headers: await authHeaders() });
  return res.data.requests ?? [];
}

export async function getSubmissions(scope: "mine" | "shared"): Promise<Submission[]> {
  const res = await axios.get(`${API_URL}/work/submissions`, { params: { scope }, headers: await authHeaders() });
  return res.data.submissions ?? [];
}

export async function createSubmission(body: { requestId?: string | null; categoryId?: string; title?: string; memo?: string; files: SubmissionFile[] }): Promise<Submission> {
  const res = await axios.post(`${API_URL}/work/submissions`, body, { headers: await authHeaders() });
  return res.data.submission;
}

export async function deleteSubmission(id: string): Promise<void> {
  await axios.delete(`${API_URL}/work/submissions/${id}`, { headers: await authHeaders() });
}

export async function getPendingCount(): Promise<number> {
  const res = await axios.get(`${API_URL}/work/submissions/badge`, { headers: await authHeaders() });
  return Number(res.data?.pending) || 0;
}

// 첨부 올리기 — 채팅 업로드(work.ts uploadFile)와 같은 XHR 방식, 저장 구역만 다르다(uploads/submissions, 50MB·형식 검사는 서버)
export async function uploadSubmissionFile(
  file: { uri: string; name: string; mimeType?: string | null },
  onProgress?: (percent: number) => void,
): Promise<SubmissionFile> {
  const form = new FormData();
  form.append("file", { uri: file.uri, name: file.name, type: file.mimeType || "application/octet-stream" } as any);
  const headers = (await authHeaders()) as Record<string, string>;
  return await new Promise<SubmissionFile>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_URL}/work/submissions/upload`);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100)); };
    xhr.onload = () => {
      try {
        const j = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300) resolve(j);
        else reject(new Error(j?.error || `업로드 실패 (${xhr.status})`));
      } catch { reject(new Error(`업로드 실패 (${xhr.status})`)); }
    };
    xhr.onerror = () => reject(new Error("네트워크 오류 또는 파일을 읽을 수 없어 업로드에 실패했습니다."));
    xhr.timeout = 300000;
    xhr.ontimeout = () => reject(new Error("업로드 시간이 초과되었습니다. 네트워크 상태를 확인해주세요."));
    xhr.send(form as any);
  });
}
