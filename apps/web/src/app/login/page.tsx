import { headers } from "next/headers";
import { isDirectHost } from "@/lib/is-direct-host";
import LoginForm from "./LoginForm";

// 직영 전용 안내(EMS 계정)는 **서버에서** 주소를 보고 정한다 — 판매용 고객사 인스턴스도 같은 화면을 쓰고,
// 화면이 뜬 뒤에 정하면 안내 줄이 나중에 붙어 로그인 버튼이 한 번 내려간다(검증 loginhint2).
export default async function LoginPage() {
  const host = (await headers()).get("host") || "";
  const direct = isDirectHost(host);
  return <LoginForm direct={direct} />;
}
