import { execFile } from "child_process";
import fs from "fs/promises";
import path from "path";
import { prisma } from "@/lib/db";

// 대용량 영상 자동 압축 — 100MB 초과 영상을 백그라운드에서 1080p(H.264)로 변환.
// 2vCPU 서버라서 반드시 한 번에 1건, 최저 우선순위(nice 19 + 스레드 1)로만 돌린다.

const THRESHOLD = 100 * 1024 * 1024; // 100MB 초과만 압축
const KEEP_RATIO = 0.9; // 압축해도 원본의 90% 이상이면 효과 없음 → 원본 유지

// 업로드 직후 호출 — 대상이면 압축 큐에 등록
export async function enqueueVideoCompress(fileUrl: string, size: number) {
  if (size <= THRESHOLD) return;
  try {
    await prisma.videoCompressJob.create({ data: { fileUrl, origSize: size } });
  } catch {
    // 중복 등록(unique 충돌)은 무시
  }
}

// 스케줄러 틱마다 호출 — 진행 중인 작업이 없으면 가장 오래된 대기 1건 처리
export async function runVideoCompressQueue() {
  // 서버 재시작 등으로 RUNNING에 갇힌 작업 복구 (2시간 경과 시 재시도)
  await prisma.videoCompressJob.updateMany({
    where: { status: "RUNNING", updatedAt: { lt: new Date(Date.now() - 2 * 60 * 60 * 1000) } },
    data: { status: "PENDING" },
  });

  const running = await prisma.videoCompressJob.count({ where: { status: "RUNNING" } });
  if (running > 0) return;

  const job = await prisma.videoCompressJob.findFirst({
    // 업로드 → 메시지 생성 사이 시차를 고려해 2분 지난 것만 처리
    where: { status: "PENDING", createdAt: { lte: new Date(Date.now() - 2 * 60 * 1000) } },
    orderBy: { createdAt: "asc" },
  });
  if (!job) return;

  await prisma.videoCompressJob.update({ where: { id: job.id }, data: { status: "RUNNING" } });
  try {
    const r = await compressOne(job.fileUrl);
    await prisma.videoCompressJob.update({
      where: { id: job.id },
      data: { status: r.status, newSize: r.newSize ?? null, error: r.note ?? null },
    });
    if (r.status === "DONE")
      console.log(`[압축] ${job.fileUrl} — ${Math.round(job.origSize / 1024 / 1024)}MB → ${Math.round((r.newSize || 0) / 1024 / 1024)}MB`);
  } catch (e) {
    await prisma.videoCompressJob.update({
      where: { id: job.id },
      data: { status: "FAILED", error: ((e as Error)?.message || "unknown").slice(0, 500) },
    });
  }
}

async function compressOne(
  fileUrl: string
): Promise<{ status: "DONE" | "FAILED" | "SKIPPED"; newSize?: number; note?: string }> {
  const rel = fileUrl.replace(/^\/api\/uploads\//, "");
  if (rel === fileUrl || rel.includes("..")) return { status: "FAILED", note: "잘못된 경로" };
  const baseDir = path.join(process.cwd(), "uploads");
  const inPath = path.join(baseDir, ...rel.split("/"));

  const st = await fs.stat(inPath).catch(() => null);
  if (!st) return { status: "FAILED", note: "원본 파일 없음" };

  const outName = path.basename(inPath).replace(/\.[^.]+$/, "") + "-c.mp4";
  const outPath = path.join(baseDir, "work", outName);

  // 1080p 이하로 축소(원본이 더 작으면 그대로), H.264 CRF 28 + faststart(웹 즉시 재생)
  await new Promise<void>((resolve, reject) => {
    execFile(
      "nice",
      ["-n", "19", "ffmpeg", "-y", "-i", inPath,
        "-vf", "scale='min(1920,iw)':-2",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "28", "-threads", "1",
        "-c:a", "aac", "-b:a", "128k",
        "-movflags", "+faststart",
        outPath],
      { timeout: 60 * 60 * 1000 }, // 1시간 상한
      (err) => (err ? reject(err) : resolve())
    );
  }).catch(async (e) => {
    await fs.unlink(outPath).catch(() => {});
    throw e;
  });

  const outSt = await fs.stat(outPath).catch(() => null);
  if (!outSt || outSt.size === 0) {
    await fs.unlink(outPath).catch(() => {});
    return { status: "FAILED", note: "변환 결과 없음" };
  }
  if (outSt.size >= st.size * KEEP_RATIO) {
    await fs.unlink(outPath).catch(() => {});
    return { status: "SKIPPED", newSize: outSt.size, note: "압축 효과 없음 — 원본 유지" };
  }

  // 이 파일을 쓰는 채팅 메시지가 있어야 교체 (공지·브리핑 첨부 등 다른 참조는 건드리지 않음)
  const msg = await prisma.workMessage.findFirst({ where: { fileUrl }, select: { fileName: true } });
  if (!msg) {
    await fs.unlink(outPath).catch(() => {});
    return { status: "SKIPPED", newSize: outSt.size, note: "채팅 참조 없음 — 원본 유지" };
  }
  const newFileName = (msg.fileName || "video").replace(/\.[^.]+$/, "") + ".mp4";
  await prisma.workMessage.updateMany({
    where: { fileUrl },
    data: { fileUrl: `/api/uploads/work/${outName}`, fileName: newFileName },
  });
  await fs.unlink(inPath).catch(() => {});
  return { status: "DONE", newSize: outSt.size };
}
