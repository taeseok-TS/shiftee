import axios from "axios";
import { getToken } from "./storage";
import { API_URL } from "../config";

// 임신기 신청서 진단서 첨부(#242, 웹 lib/contract-medical) — 본인·본부는 목록, 결재자는 첨부 수만 받는다
export type MedicalAtt = { attId: string; name: string; size: number; mime: string; uploadedAt: string; byAdmin: boolean };
export type MedicalInfo =
  | { required: false }
  | { required: true; reapply: boolean; attachments?: MedicalAtt[]; count?: number; canUpload?: boolean; maxFiles?: number };

async function authHeaders(): Promise<Record<string, string>> {
  const token = await getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function getMedical(contractId: string): Promise<MedicalInfo> {
  const res = await axios.get(`${API_URL}/contracts/${contractId}/attachments`, { headers: await authHeaders() });
  return res.data as MedicalInfo;
}

// 올리기 — 자료제출(submissions.ts)과 같은 XHR 방식. Content-Type 은 직접 넣지 않는다(경계가 빠진다)
export async function uploadMedical(contractId: string, file: { uri: string; name: string; mimeType?: string | null }): Promise<void> {
  const form = new FormData();
  form.append("file", { uri: file.uri, name: file.name, type: file.mimeType || "application/octet-stream" } as any);
  const headers = await authHeaders();
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_URL}/contracts/${contractId}/attachments`);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.onload = () => {
      let j: any = null;
      try { j = JSON.parse(xhr.responseText); } catch { /* 아래 */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(j?.error || `올리지 못했습니다 (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error("네트워크 오류로 올리지 못했습니다."));
    xhr.timeout = 120000;
    xhr.ontimeout = () => reject(new Error("올리는 시간이 초과되었습니다. 네트워크 상태를 확인해주세요."));
    xhr.send(form as any);
  });
}
