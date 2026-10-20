// 입학정보실(진학입시EX) 입장권 — 2026-10-19 디렉터 결정: 큐브티에 속한 직원 전체(로그인한 재직 사용자 모두)에게 연다.
// 규격은 진학입시EX docs/10_입학정보실_큐브티_입장권.md 3절 그대로다(진학입시EX 의 lib/info-pass.ts verifyInfoPass 가 검사한다).
//   header  {"alg":"HS256","typ":"JWT"}
//   payload {"iss":"cubeteework","aud":"jinhak-info","sub":<큐브티 사용자 id>,"name":<표시 이름 40자까지>,"iat","exp":iat+60,"jti":<입장권마다 새 randomUUID>}
//   주소    https://jinhak-ex.vercel.app/info/enter?t=<입장권>
// ⚠ 비밀 열쇠(INFO_PASS_SECRET)는 서버 환경 변수에서만 읽는다 — 값·입장권을 로그·감사 기록·브라우저 저장소에 남기지 않는다.
// 같은 입장권은 진학입시EX 가 한 번만 받아 준다(jti 기록). 화면은 누를 때마다 서버에서 새로 받아 바로 연다.
import { createHmac, randomUUID } from "node:crypto";

export const JINHAK_INFO_ENTER_URL = "https://jinhak-ex.vercel.app/info/enter";
const PASS_TTL_SEC = 60;      // 규격 권장값(진학입시EX 는 120초까지 받는다)
const NAME_MAX = 40;          // 진학입시EX 가 40자에서 자른다 — 보내는 쪽에서도 맞춰 둔다
const MIN_SECRET_LEN = 32;

/** 열쇠가 없거나 32자 미만이면 null — 부르는 쪽은 「연결 준비 중」으로 답한다(값은 어디에도 찍지 않는다) */
export function jinhakInfoSecret(): string | null {
  const s = process.env.INFO_PASS_SECRET ?? "";
  return s.length >= MIN_SECRET_LEN ? s : null;
}

/** 단추를 보일지 — 열쇠가 있고 INFO_PASS_ENABLED=1 일 때만(2026-10-19 디렉터 「잠깐 숨겨놔」 — 진학입시EX 쪽 열쇠가 들어가면 .env 만 바꿔 켠다) */
export function jinhakInfoEnabled(): boolean {
  return process.env.INFO_PASS_ENABLED === "1" && jinhakInfoSecret() !== null;
}

const b64url = (buf: Buffer) => buf.toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
const enc = (o: unknown) => b64url(Buffer.from(JSON.stringify(o), "utf8"));

/** 진학입시EX 가 받는 이름 꼴로 다듬는다 — 제어 문자 빼고 40자(글자 단위)에서 자른다. 비면 null */
function shownName(name: string): string | null {
  const clean = name.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (!clean) return null;
  return Array.from(clean).slice(0, NAME_MAX).join("").trim();
}

/** 입장권(JWT HS256) 하나를 만든다. sub = 큐브티 사용자 id(cuid — 규격의 영문·숫자 1~120자에 맞는다) */
export function signJinhakInfoPass(input: { sub: string; name: string; nowSec?: number }, secret: string): string {
  const iat = input.nowSec ?? Math.floor(Date.now() / 1000);
  const name = shownName(input.name); // 이름이 없으면 칸을 빼 둔다 — 진학입시EX 가 「큐브티 매니저」로 채운다
  const payload = {
    iss: "cubeteework",
    aud: "jinhak-info",
    sub: input.sub,
    ...(name ? { name } : {}),
    iat,
    exp: iat + PASS_TTL_SEC,
    jti: randomUUID(),
  };
  const head = `${enc({ alg: "HS256", typ: "JWT" })}.${enc(payload)}`;
  return `${head}.${b64url(createHmac("sha256", secret).update(head).digest())}`;
}

/** 입장 주소 */
export function jinhakInfoEnterUrl(token: string): string {
  return `${JINHAK_INFO_ENTER_URL}?t=${encodeURIComponent(token)}`;
}
