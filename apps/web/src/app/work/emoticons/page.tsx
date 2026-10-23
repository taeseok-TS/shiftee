import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import EmoticonsManager from "@/components/admin/EmoticonsManager";

// 큐브티워크 › 이모티콘(채팅 스티커 관리) — 설정 › 개발자에서 옮겨 옴(2026-10-23 본부 요청 ■0-3). 권한은 종전과 같게 관리자(본부)만
export const dynamic = "force-dynamic";

export default async function WorkEmoticonsPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "ADMIN") redirect("/work/chat");
  return <EmoticonsManager />;
}
