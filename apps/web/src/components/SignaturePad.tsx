"use client";

import { useRef, useEffect, useImperativeHandle, forwardRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Eraser } from "lucide-react";

export type SignaturePadHandle = {
  isEmpty: () => boolean;
  toDataURL: () => string;
  clear: () => void;
  loadImage: (url: string) => Promise<boolean>; // 저장된 서명 불러오기 (개선 제안 #75)
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

    // 획이 그려진 영역만 잘라서 반환 — 캔버스 전체를 그대로 쓰면 아래·좌우 빈 여백까지
    // 이미지에 들어가, 문서에 넣었을 때 서명이 이름 줄보다 위로 떠 보인다 (#166·#173, 2026-08-27)
    function trimmedDataURL(): string {
      const canvas = canvasRef.current!;
      const ctx = canvas.getContext("2d")!;
      const { width: W, height: H } = canvas;
      try {
        const data = ctx.getImageData(0, 0, W, H).data;
        let minX = W, minY = H, maxX = -1, maxY = -1;
        for (let y = 0; y < H; y++) {
          for (let x = 0; x < W; x++) {
            const i = (y * W + x) * 4;
            // 흰 배경(255,255,255)이 아닌 픽셀 = 획
            if (data[i] < 245 || data[i + 1] < 245 || data[i + 2] < 245) {
              if (x < minX) minX = x;
              if (x > maxX) maxX = x;
              if (y < minY) minY = y;
              if (y > maxY) maxY = y;
            }
          }
        }
        if (maxX < 0) return canvas.toDataURL("image/png"); // 획 없음 — 원본
        const pad = Math.round(4 * (window.devicePixelRatio || 1));
        const sx = Math.max(0, minX - pad), sy = Math.max(0, minY - pad);
        const sw = Math.min(W - sx, maxX - minX + pad * 2);
        const sh = Math.min(H - sy, maxY - minY + pad * 2);
        const out = document.createElement("canvas");
        out.width = sw; out.height = sh;
        const octx = out.getContext("2d")!;
        octx.fillStyle = "#ffffff";
        octx.fillRect(0, 0, sw, sh);
        octx.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
        return out.toDataURL("image/png");
      } catch {
        return canvas.toDataURL("image/png"); // 보안 제약 등 — 원본으로 폴백
      }
    }

    useImperativeHandle(ref, () => ({
      isEmpty: () => empty,
      toDataURL: () => trimmedDataURL(),
      clear,
      loadImage: (url: string) =>
        new Promise<boolean>((resolve) => {
          const img = new Image();
          img.onload = () => {
            const canvas = canvasRef.current;
            if (!canvas) { resolve(false); return; }
            const ctx = canvas.getContext("2d")!;
            const rect = canvas.getBoundingClientRect();
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(0, 0, rect.width, rect.height);
            // 비율 유지로 가운데 배치 (원본이 더 크면 축소)
            const scale = Math.min(rect.width / img.width, rect.height / img.height, 1);
            const w = img.width * scale, h = img.height * scale;
            ctx.drawImage(img, (rect.width - w) / 2, (rect.height - h) / 2, w, h);
            setEmpty(false);
            resolve(true);
          };
          img.onerror = () => resolve(false);
          img.src = url;
        }),
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
