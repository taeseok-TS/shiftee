"use client";
import { toast } from "sonner";

// 세션이 끊겼는데 화면은 정상으로 보이던 문제 (2026-09-04 검증 지적)
//
// 배경: 사이드바.배지의 주기 폴링이 `if (res.ok)` / `catch {}` 로 실패를 조용히 삼켜,
// 로그인이 만료돼도 **화면은 옛 정보를 그대로 보여주고 계속 서버를 찔렀다**
// (운영 로그 2.4시간에 401 이 417건, 전부 한 사람). 출퇴근.근무일정 화면에서는
// 표시 문제가 아니라 **낡은 정보를 현재로 오인**하는 문제다.
// 게다가 감시(access-log)가 401 을 소음으로 버리므로 이 상태는 기록에도 안 남는다.
//
// 여러 폴링이 동시에 401 을 받으므로 안내.이동은 **한 번만** 한다.
let handled = false;

/** 401 이면 안내 후 로그인 화면으로 보낸다. 만료면 true — 호출부는 폴링을 멈춘다. */
export function isSessionExpired(res: Response): boolean {
  if (res.status !== 401) return false;
  if (handled) return true;
  handled = true;
  try {
    // 이미 로그인 화면이면 되돌릴 필요가 없다(무한 이동 방지)
    if (window.location.pathname.startsWith("/login")) return true;
    toast.error("로그인이 만료되었습니다. 다시 로그인해주세요.");
    // 종전에는 그냥 /login 으로 보내 **원래 보던 화면으로 못 돌아왔다** (검증관 B).
    const back = window.location.pathname + window.location.search;
    setTimeout(() => {
      window.location.href = "/login?next=" + encodeURIComponent(back);
    }, 1500);
  } catch { /* 안내 실패가 다른 동작을 막으면 안 된다 */ }
  return true;
}
