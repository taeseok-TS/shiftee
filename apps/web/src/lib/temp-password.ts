// 임시 비밀번호 — 관리자 초기화·신규 계정 발급용 (2026-09-30 디렉터 지시).
//
// 종전에는 모두 "12345678" 이었다. 누구나 아는 값이라 이메일만 알면 남이 먼저 들어갈 수 있었고,
// 계정을 일부러 잠가 관리자 초기화를 유도한 뒤 12345678 로 들어오는 길도 열려 있었다(로그인 제한 검증관 P1).
// 이제는 매번 무작위로 만들고, 등록 이메일로 보낸다(관리자 초기화는 화면에도 한 번 보여 준다).
//
// 폰으로 옮겨 치기 쉽게: 소문자·숫자만, 헷갈리는 글자(0 o 1 l i)는 뺐다. "7abc-d2ef" 모양 8글자(+하이픈).
// **첫 글자는 항상 숫자** — 폰 자판이 입력칸 첫 글자를 대문자로 올리면(옛 앱 로그인칸에 autoCapitalize 가 없었다)
// 소문자로 시작하는 값은 틀린 비밀번호가 되어 10번 만에 잠긴다(검증관 P-1).
// 8 × 31^7 ≈ 2^37 — 로그인 시도 제한(15분 10번)과 함께면 맞춰 볼 수 없다.
import { randomInt } from "crypto";

const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const DIGITS = "23456789";

export function generateTempPassword(): string {
  const pick = (chars: string, n: number) => Array.from({ length: n }, () => chars[randomInt(chars.length)]).join("");
  return `${pick(DIGITS, 1)}${pick(ALPHABET, 3)}-${pick(ALPHABET, 4)}`;
}
