/**
 * ============================================
 * 큐브티 Mobile - 입학정보실(진학입시EX) 열기 (2026-10-19 디렉터 결정: 큐브티 직원 전체)
 * 웹 POST /api/integrations/jinhak-info/pass 가 60초짜리 입장 주소를 만들어 준다 → 바로 브라우저로 연다.
 * 입장권은 한 번만 쓰이므로 어디에도 저장하지 않는다(누를 때마다 새로 받는다).
 * ============================================
 */
import axios from "axios";
import { Alert, Linking } from "react-native";
import { API_URL } from "../config";
import { getToken } from "./storage";

let busy = false;

export async function openJinhakInfo(): Promise<void> {
  if (busy) return; // 연달아 눌러 두 번 열리지 않게
  busy = true;
  try {
    const token = await getToken();
    const res = await axios.post(`${API_URL}/integrations/jinhak-info/pass`, null, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      timeout: 15000,
    });
    const url = res.data?.url;
    if (typeof url !== "string" || !url.startsWith("https://")) throw new Error("bad-url");
    await Linking.openURL(url);
  } catch (e: unknown) {
    const status = axios.isAxiosError(e) ? e.response?.status : undefined;
    const msg = axios.isAxiosError(e) ? (e.response?.data as { error?: string } | undefined)?.error : undefined;
    if (status === 401) Alert.alert("입학정보실", "로그인이 끝났습니다. 다시 로그인해 주세요.");
    else Alert.alert("입학정보실", msg || "입학정보실을 열지 못했습니다. 잠시 뒤 다시 눌러 주세요.");
  } finally {
    busy = false;
  }
}
