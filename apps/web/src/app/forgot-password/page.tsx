import { headers } from "next/headers";
import ForgotPasswordForm from "./ForgotPasswordForm";

// 로그인 화면과 같은 규칙 — 직영 주소에서만 EMS 계정 안내를 띄운다(서버에서 정해 안내가 나중에 붙지 않게).
export default async function ForgotPasswordPage() {
  const host = (await headers()).get("host") || "";
  const direct = /^(www\.)?cubetee\.co\.kr(:\d+)?$/.test(host);
  return <ForgotPasswordForm direct={direct} />;
}
