import { headers } from "next/headers";
import LoginForm from "./LoginForm";

// 직영 전용 안내(EMS 계정)는 **서버에서** 주소를 보고 정한다 — 판매용 고객사 인스턴스도 같은 화면을 쓰고,
// 화면이 뜬 뒤에 정하면 안내 줄이 나중에 붙어 로그인 버튼이 한 번 내려간다(검증 loginhint2).
// ⚠ 하위 주소 전체(*.cubetee.co.kr)로 보면 안 된다 — 고객사 기본 주소가 "회사명.cubetee.co.kr" 이다.
export default async function LoginPage() {
  const host = (await headers()).get("host") || "";
  const direct = /^(www\.)?cubetee\.co\.kr(:\d+)?$/.test(host);
  return <LoginForm direct={direct} />;
}
