"use client";
// 본인 확인 비밀번호 칸 — 승인·서명·문서 열기 때 다시 묻는 로그인 비밀번호(2026-10-21 본부 이예지 [중요]).
// 브라우저·비밀번호 관리자가 저장된 비밀번호를 미리 채워 두면 공용 PC·남의 기기에서 본인 확인이 무력해진다 — 자동 채움을 막는다.
// 로그인 화면은 이 칸을 쓰지 않는다(그곳은 자동 완성이 맞다).
//  · autoComplete="one-time-code" — 저장된 비밀번호를 채우지 않고, 「새 비밀번호」 칸처럼 강력한 비밀번호 제안도 띄우지 않는다(검증 지적)
//  · 처음엔 읽기 전용 — 화면을 열 때 들어오는 자동 채움을 받지 않고, 누르거나 포커스가 오면 풀린다
//  · 이름을 칸마다 다르게, 비밀번호 관리자 확장(1Password·LastPass 등)에 「무시」 표식
import { useId, useState, type ComponentProps } from "react";
import { Input } from "@/components/ui/input";

type Props = Omit<ComponentProps<"input">, "type" | "autoComplete" | "name"> & { plain?: boolean };   // plain = 화면이 직접 꾸민 칸(기본 Input 모양을 쓰지 않음)

export function ReauthPasswordInput({ plain = false, readOnly, onFocus, onPointerDown, ...rest }: Props) {
  const id = useId();
  const [locked, setLocked] = useState(true);
  const props = {
    ...rest,
    type: "password",
    name: `reauth-${id.replace(/[^a-zA-Z0-9]/g, "")}`,
    autoComplete: "one-time-code",
    "data-lpignore": "true",
    "data-1p-ignore": "true",
    "data-form-type": "other",
    readOnly: readOnly || locked,
    onFocus: (e: React.FocusEvent<HTMLInputElement>) => { setLocked(false); onFocus?.(e); },
    onPointerDown: (e: React.PointerEvent<HTMLInputElement>) => { setLocked(false); onPointerDown?.(e); },
  };
  return plain ? <input {...props} /> : <Input {...props} />;
}
