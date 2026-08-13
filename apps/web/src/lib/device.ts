import { prisma } from "@/lib/db";

/**
 * 출퇴근 기기 검증 (대리 출퇴근 방지)
 * - 관리자(ADMIN)는 예외 (웹에서도 가능)
 * - 그 외에는 등록된 본인 기기의 앱에서만 출퇴근 가능
 * - 기기 등록(바인딩)은 오직 앱 로그인에서만 이뤄진다. 여기서 자동 등록하면
 *   탈취된 웹 세션으로 임의 기기ID를 선점 등록할 수 있으므로 금지.
 * @returns 에러 메시지(차단) 또는 null(허용)
 */
export async function verifyAttendanceDevice(
  userId: string,
  role: string,
  deviceId: string | null
): Promise<string | null> {
  if (role === "ADMIN") return null;
  if (!deviceId)
    return "출퇴근은 등록된 본인 휴대폰 앱에서만 가능합니다.";
  const registered = await prisma.userDevice.findUnique({ where: { userId } });
  if (!registered)
    return "기기가 등록되어 있지 않습니다. 앱에서 로그아웃 후 다시 로그인하면 이 기기가 등록됩니다.";
  if (registered.deviceId !== deviceId)
    return "등록되지 않은 기기입니다. 본인 휴대폰에서만 출퇴근할 수 있습니다. 기기를 변경했다면 관리자에게 기기 초기화를 요청해주세요.";
  return null;
}
