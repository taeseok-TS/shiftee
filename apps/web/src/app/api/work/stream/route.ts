import { NextRequest } from "next/server";
import { getSession, isSessionStillValid } from "@/lib/auth";
import { workBus, type WorkEvent } from "@/lib/work-events";

export const dynamic = "force-dynamic";

// 시프티워크 실시간 이벤트 스트림 (SSE)
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return new Response("Unauthorized", { status: 401 });

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const send = (data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          /* 닫힌 컨트롤러 무시 */
        }
      };

      send({ type: "connected" });

      const onEvent = (e: WorkEvent) => {
        // 본인이 발생시킨 타이핑은 제외
        if (e.type === "typing" && e.userId === session.userId) return;
        send(e);
      };
      workBus.on("event", onEvent);

      // keep-alive ping (프록시 타임아웃 방지)
      const ping = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          /* noop */
        }
      }, 25000);

      // 세션이 죽었으면 이 연결도 끊는다. 접속할 때 한 번만 인증하고 무기한 유지되면,
      // 퇴사.기기초기화로 토큰을 끊어도 이미 열린 창으로 이벤트가 계속 흘러간다.
      // (30초 캐시가 있어 실제 DB 조회는 사용자당 그보다 자주 일어나지 않는다)
      const recheck = setInterval(() => {
        isSessionStillValid(session)
          .then((ok) => { if (!ok) close(); })
          .catch(() => { /* 조회 실패는 유지 — DB 가 흔들렸다고 전원 끊으면 안 된다 */ });
      }, 60000);

      const close = () => {
        clearInterval(ping);
        clearInterval(recheck);
        workBus.off("event", onEvent);
        try {
          controller.close();
        } catch {
          /* noop */
        }
      };

      request.signal.addEventListener("abort", close);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
