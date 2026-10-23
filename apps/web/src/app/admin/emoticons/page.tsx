import { redirect } from "next/navigation";

// 이모티콘 관리는 「큐브티워크 › 이모티콘」으로 옮겼다(2026-10-23 본부 요청 ■0-3). 옛 주소 · 북마크는 그쪽으로 보낸다
export default function AdminEmoticonsRedirect() {
  redirect("/work/emoticons");
}
