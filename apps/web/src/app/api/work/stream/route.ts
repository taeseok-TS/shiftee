import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
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

      const close = () => {
        clearInterval(ping);
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
