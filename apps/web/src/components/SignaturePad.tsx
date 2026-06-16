"use client";

import { useRef, useEffect, useImperativeHandle, forwardRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Eraser } from "lucide-react";

export type SignaturePadHandle = {
  isEmpty: () => boolean;
  toDataURL: () => string;
  clear: () => void;
};

// 마우스·터치·펜으로 손글씨 서명을 그리는 캔버스
export const SignaturePad = forwardRef<SignaturePadHandle, { height?: number }>(
  function SignaturePad({ height = 200 }, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const drawing = useRef(false);
    const last = useRef<{ x: number; y: number } | null>(null);
    const [empty, setEmpty] = useState(true);

    // 고해상도 대응 + 흰 배경 초기화
    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ratio = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * ratio;
      canvas.height = rect.height * ratio;
      const ctx = canvas.getContext("2d")!;
      ctx.scale(ratio, ratio);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, rect.width, rect.height);
      ctx.strokeStyle = "#111827";
      ctx.lineWidth = 2.2;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
    }, []);

    function pos(e: React.PointerEvent) {
      const rect = canvasRef.current!.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }

    function start(e: React.PointerEvent) {
      e.preventDefault();
      canvasRef.current!.setPointerCapture(e.pointerId);
      drawing.current = true;
      last.current = pos(e);
    }
    function move(e: React.PointerEvent) {
      if (!drawing.current) return;
      e.preventDefault();
      const ctx = canvasRef.current!.getContext("2d")!;
      const p = pos(e);
      ctx.beginPath();
      ctx.moveTo(last.current!.x, last.current!.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      last.current = p;
      if (empty) setEmpty(false);
    }
    function end() {
      drawing.current = false;
      last.current = null;
    }

    function clear() {
      const canvas = canvasRef.current!;
      const ctx = canvas.getContext("2d")!;
      const rect = canvas.getBoundingClientRect();
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, rect.width, rect.height);
      setEmpty(true);
    }

    useImperativeHandle(ref, () => ({
      isEmpty: () => empty,
      toDataURL: () => canvasRef.current!.toDataURL("image/png"),
      clear,
    }));

    return (
      <div className="space-y-2">
        <canvas
          ref={canvasRef}
          style={{ height, touchAction: "none" }}
          className="w-full border-2 border-dashed border-gray-300 rounded-lg bg-white cursor-crosshair"
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerLeave={end}
        />
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-400">마우스·손가락·펜으로 서명해주세요</span>
          <Button type="button" size="sm" variant="ghost" onClick={clear} className="gap-1 text-gray-500">
            <Eraser size={14} />지우기
          </Button>
        </div>
      </div>
    );
  }
);
