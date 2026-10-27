import { prisma } from "@/lib/db";
import { haversineDistance } from "@/lib/geofence";

// 출퇴근 위치 판정 + 시도 기록(2026-10-27 이예지 「지점 밖 판정」 조사) — clock-in · clock-out 이 같은 함수로 판정하고 한 줄 남긴다.
// 종전에는 403 만 돌려주고 아무것도 남지 않아 「누가 몇 번 실패했는지」를 본부가 볼 수 없었다.
// 기록은 fire-and-forget — 표가 없거나 쓰기가 실패해도 출퇴근은 그대로 간다.

export type GeoBranch = { name: string; latitude: number | null; longitude: number | null; radius: number };
export type GeoVerdict = {
  inside: boolean;
  /** 반경 안에 든 지점(inside 일 때) 또는 가장 가까운 지점 */
  branch: string | null;
  distance: number | null;   // m, 반올림
  radius: number | null;
};

/** 담당 지점들 중 반경 안이 있으면 그 지점, 전부 밖이면 가장 가까운 지점으로 판정 */
export function judgeGeofence(lat: number, lng: number, branches: GeoBranch[]): GeoVerdict {
  // 판정은 반올림 전 실수로(종전 clock-in 과 같은 비교 — 반올림하면 반경 밖 0.5m 가 「안」이 된다, 10/27 검증), 기록 · 응답만 반올림
  let nearest: GeoVerdict = { inside: false, branch: null, distance: null, radius: null };
  let nearestRaw = Number.POSITIVE_INFINITY;
  for (const b of branches) {
    if (b.latitude == null || b.longitude == null) continue;
    const raw = haversineDistance(lat, lng, b.latitude, b.longitude);
    if (raw <= b.radius) return { inside: true, branch: b.name, distance: Math.round(raw), radius: b.radius };
    if (raw < nearestRaw) { nearestRaw = raw; nearest = { inside: false, branch: b.name, distance: Math.round(raw), radius: b.radius }; }
  }
  return nearest;
}

export type AttemptInput = {
  userId: string;
  action: "IN" | "OUT";
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
  verdict: GeoVerdict | null;   // 위치가 없으면 null
  result: "OK" | "OUTSIDE" | "NO_LOCATION";
  headers: Headers;
};

/** 요청 헤더에서 기기 · OS · 앱 버전(앱이 보내면) */
export function clientInfo(headers: Headers) {
  const cut = (v: string | null, n: number) => (v && v.trim() ? v.trim().slice(0, n) : null);
  return { deviceId: cut(headers.get("x-device-id"), 120), platform: cut(headers.get("x-platform"), 20), appVersion: cut(headers.get("x-app-version"), 40) };
}

export function logGeofenceAttempt(input: AttemptInput): void {
  const { deviceId, platform, appVersion } = clientInfo(input.headers);
  prisma.geofenceAttempt
    .create({
      data: {
        userId: input.userId, action: input.action, latitude: input.latitude, longitude: input.longitude, accuracy: input.accuracy,
        branch: input.verdict?.branch ?? null, distance: input.verdict?.distance ?? null, radius: input.verdict?.radius ?? null,
        result: input.result, deviceId, platform, appVersion,
      },
    })
    .catch((e) => console.error("[geofence-log] 기록 실패(출퇴근은 그대로):", e instanceof Error ? e.message : e));
}

/** body 의 위치 오차(m) — 숫자가 아니거나 음수면 null, 너무 큰 값은 99999 로 */
export function parseAccuracy(v: unknown): number | null {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0) return null;
  return Math.min(Math.round(n), 99999);
}
