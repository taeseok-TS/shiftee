import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getAppUrl, approvalPageUrl } from "@/lib/app-url";
import { sendApprovalRequest, sendContractCompletion } from "@/lib/email";
import { hrBotSendDM } from "@/lib/bot";
import { notifyStepApprovedToCreator, notifyContractCompleted } from "@/lib/contract-notify";
import { fillDocxTemplate, buildContractMergeData, buildFieldSummary } from "@/lib/contract-fields";
import fs from "fs/promises";
import path from "path";
import bcrypt from "bcryptjs";
import type { Prisma } from "@prisma/client";
import { lockSteps } from "@/lib/contract-reset";
import { recordContractEvent } from "@/lib/contract-events";
import { SIGN_CONSENT_TEXT } from "@/lib/contract-consent";

// 본인 서명 비밀번호 확인 — 틀린 횟수 제한(5번 → 15분 잠금). 로그인과 다른 경로라 여기서도 막는다.
// globalThis 싱글턴(개발 핫리로드에도 한 벌). 서버 1대라 프로세스 메모리로 충분하다.
const gpw = globalThis as unknown as { __signPwFails?: Map<string, { count: number; until: number }> };
const pwFails = (gpw.__signPwFails ??= new Map<string, { count: number; until: number }>());
// 시도를 **비교 전에** 센다(#205 검증 A4) — 확인과 기록 사이에 DB 조회·bcrypt(비동기)가 끼면 동시 요청 N개가 모두
// 비교됐다. 여기는 동기 코드라 확인과 계수가 한 번에 일어난다. 잠겨 있으면 풀리는 시각(ms), 아니면 0. 성공하면 기록을 지운다.
const pwTakeAttempt = (u: string): number => {
  const f = pwFails.get(u) ?? { count: 0, until: 0 };
  if (f.until > Date.now()) return f.until;
  f.count += 1;
  if (f.count >= 5) { f.until = Date.now() + 15 * 60 * 1000; f.count = 0; }
  pwFails.set(u, f);
  return 0;
};

// 서명 확정 실패 사유 — 409 로 돌려준다
type SignFail = "DOC_CHANGED" | "STEP_CHANGED";
const SIGN_FAIL: Record<SignFail, string> = {
  DOC_CHANGED: "서명 창을 연 뒤 문서가 수정됐습니다. 화면을 새로 고쳐 바뀐 내용을 확인한 뒤 다시 서명해 주세요.",
  STEP_CHANGED: "이미 처리됐거나 결재가 다시 시작된 문서입니다. 화면을 새로 고친 뒤 다시 확인해 주세요.",
};

/**
 * 서명 확정 — 찜(조건부) + 다음 단계 + 계약 갱신을 **한 트랜잭션**으로(#206 검증 D1).
 * 찜만 따로 커밋하면 그 틈에 관리자의 제자리 초기화가 끼어들어, 뒤따르는 "다음 단계 PENDING·계약 APPROVED/SIGNED"가
 * 초기화된 결재 위에 덮였다(1·3단계 동시 대기, 서명 없는 완료). 단계 행을 먼저 잠그고(수정 저장·초기화·반려와 같은
 * 순서: 단계 → 계약) 그 안에서 문서 버전을 다시 본다 — 버전 증가도 수정 저장 트랜잭션 안에서 일어나 둘은 겹치지 않는다.
 */
async function commitSign(
  id: string, stepId: string, nextStepId: string | null, signatureUrl: string, seenVersion: number,
  data: Prisma.ContractUpdateInput
) {
  let fail = null as SignFail | null;
  const contract = await prisma.$transaction(async (tx) => {
    await lockSteps(tx, id);
    if (Number.isFinite(seenVersion)) {
      const fresh = await tx.contract.findUnique({ where: { id }, select: { version: true } });
      if (fresh && fresh.version !== seenVersion) { fail = "DOC_CHANGED"; throw new Error(fail); }
    }
    const claimed = await tx.contractApprovalStep.updateMany({
      where: { id: stepId, status: "PENDING" },
      data: { status: "APPROVED", decidedAt: new Date(), signatureUrl },
    });
    if (claimed.count === 0) { fail = "STEP_CHANGED"; throw new Error(fail); }
    if (nextStepId) {
      // 다음 단계는 아직 대기(WAITING)일 때만 차례로 올린다 — 그 사이 결재선이 바뀌었으면 확정하지 않는다
      const moved = await tx.contractApprovalStep.updateMany({
        where: { id: nextStepId, status: { in: ["WAITING", "PENDING"] } },
        data: { status: "PENDING" },
      });
      if (moved.count === 0) { fail = "STEP_CHANGED"; throw new Error(fail); }
    }
    return tx.contract.update({
      where: { id },
      data,
      include: {
        user: { select: { id: true, name: true, email: true } },
        approvalLine: { include: { steps: { include: { approver: { select: { id: true, name: true, email: true, role: true } } } } } },
      },
    });
  }).catch((e) => { if (fail) return null; throw e; });
  if (!contract) return { ok: false as const, code: (fail ?? "STEP_CHANGED") as SignFail };
  return { ok: true as const, contract };
}

// 손글씨 서명(dataURL PNG)을 파일로 저장하고 URL 반환
async function saveSignature(dataUrl: string): Promise<string | null> {
  const m = /^data:image\/png;base64,(.+)$/.exec(dataUrl || "");
  if (!m) return null;
  const buffer = Buffer.from(m[1], "base64");
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}-sign.png`;
  const dir = path.join(process.cwd(), "uploads", "signatures");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, filename), buffer);
  return `/api/uploads/signatures/${filename}`;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const { signatureData, isApprover, consent, profile, fields, useSaved, saveAsDefault, password, agree, readToEnd } = body;

  const contract = await prisma.contract.findUnique({
    where: { id },
    include: { approvalLine: { include: { steps: { orderBy: { order: "asc" }, include: { approver: true } } } } },
  });

  if (!contract) return NextResponse.json({ error: "계약서를 찾을 수 없습니다." }, { status: 404 });

  // ── 근로자 본인 서명 단계 (#205-1·#205-2, 2026-09-11 디렉터 결정) ──
  // 로그인만 돼 있으면 선 하나로 서명이 통과됐다(이예지대리 #205-1). 근로자 본인 서명은 **비밀번호를 다시 확인**하고
  // **매번 직접 그린 서명**만 받는다 — 저장 서명이 자동으로 쓰이면 "문서를 보지 못했다"는 다툼이 생긴다(#205-2).
  // 결재자(원장·본부) 서명은 지금처럼(저장 서명·원클릭 유지). 외부 계약자는 게스트 링크의 연락처 뒷자리 확인으로.
  // ⚠ 서명 이미지 저장·기본 서명 갱신보다 **먼저** 본다 — 종전에는 권한 판정 전에 파일부터 썼다.
  //   응답은 401 이 아니라 400/429 — 앱은 401 을 "로그인 만료"로 보고 로그아웃시킨다.
  const pendingMine = contract.approvalLine?.steps.find((st) => st.approverId === session.userId && st.status === "PENDING");
  const isEmployeeSignStep = !!pendingMine && pendingMine.approverId === contract.userId && !contract.externalName;
  if (isEmployeeSignStep) {
    // 안내 문구에 "어디서 서명하면 되는지"를 넣는다 — 원장·관리자 결재 화면은 본인 계약에 비밀번호 칸이 없고(#205 검증 A2),
    // 앱 업데이트 전 옛 앱도 칸이 없다(과도기, A6). 옛 앱은 이 문구를 그대로 띄운다.
    if (useSaved)
      return NextResponse.json({ code: "DRAW_REQUIRED", error: "본인 서명은 저장된 서명을 쓸 수 없습니다. 본인 계약 화면에서 직접 서명해 주세요(웹: 관리자·원장은 사이드바 아래 [직원 모드로 전환] → [전자계약], 앱: [더보기] → [계약서])." }, { status: 400 });
    // 전자서명 동의(#205-3) — 서명 칸 앞에서 명시적으로 체크해야 한다. 비밀번호 시도로 세기 전에 본다.
    if (agree !== true)
      return NextResponse.json({
        code: "CONSENT_REQUIRED",
        error: "전자서명 동의에 체크해 주세요. 동의 칸이 보이지 않으면 — 웹: 페이지를 새로고침(F5)한 뒤, 관리자·원장은 사이드바 아래 [직원 모드로 전환] → [전자계약]에서, 앱: 완전히 닫았다가 다시 열어 업데이트한 뒤 서명해 주세요.",
      }, { status: 400 });
    if (typeof password !== "string" || !password)
      return NextResponse.json({
        code: "PASSWORD_REQUIRED",
        error: "본인 확인을 위해 비밀번호를 입력해 주세요. 비밀번호 칸이 보이지 않으면 — 웹: 관리자·원장은 사이드바 아래 [직원 모드로 전환] → [전자계약]에서, 앱: 완전히 닫았다가 다시 열어 업데이트한 뒤 서명해 주세요.",
      }, { status: 400 });
    const lock = pwTakeAttempt(session.userId);
    if (lock)
      return NextResponse.json({ code: "PASSWORD_LOCKED", error: `비밀번호를 여러 번 틀렸습니다. ${Math.ceil((lock - Date.now()) / 60000)}분 뒤에 다시 시도해 주세요.` }, { status: 429 });
    const me = await prisma.user.findUnique({ where: { id: session.userId }, select: { password: true } });
    if (!me?.password || !(await bcrypt.compare(password, me.password)))
      return NextResponse.json({ code: "PASSWORD_MISMATCH", error: "비밀번호가 맞지 않습니다." }, { status: 400 });
    pwFails.delete(session.userId);
  }

  // 저장된 본인 서명 사용 — **결재자만**(근로자 본인 서명은 위에서 막았다) (개선 제안 #75)
  let signatureUrl: string | null = null;
  if (useSaved) {
    const me = await prisma.user.findUnique({ where: { id: session.userId }, select: { signatureUrl: true } });
    signatureUrl = me?.signatureUrl || null;
  }
  if (!signatureUrl) signatureUrl = await saveSignature(signatureData);
  // 이번에 그린 서명을 기본 서명으로 저장 (다음부터 불러오기 가능)
  if (signatureUrl && saveAsDefault) {
    try { await prisma.user.update({ where: { id: session.userId }, data: { signatureUrl } }); }
    catch (e) { console.error("기본 서명 저장 오류:", e); }
  }

  // 문서 버전 묶기(#206 검증 F2) — 서명 창을 연 뒤 관리자가 내용을 고쳤으면(버전이 올라감) 옛 화면에서 누른 서명을
  // 받지 않는다. 화면이 x-doc-version 을 보낼 때만 본다(구버전 앱은 안 보낸다 — 그때는 종전 동작).
  const seenVersionRaw = request.headers.get("x-doc-version");
  const seenVersion = seenVersionRaw ? Number(seenVersionRaw) : NaN;
  if (Number.isFinite(seenVersion) && seenVersion !== contract.version)
    return NextResponse.json({ code: "DOC_CHANGED", error: "서명 창을 연 뒤 문서가 수정됐습니다. 화면을 새로 고쳐 바뀐 내용을 확인한 뒤 다시 서명해 주세요." }, { status: 409 });

  // 서명 시 직원이 입력한 프로필(주소/생년월일)을 저장 → 이후 계약서에 자동 적용, 다시 안 물어봄
  // 외부 계약은 소유자=작성 관리자 — 관리자 결재를 당사자 서명으로 오인해 프로필·문서를 건드리면 안 됨
  if (profile && typeof profile === "object" && contract.userId === session.userId && !contract.externalName) {
    const data: Record<string, unknown> = {};
    if (typeof profile.주소 === "string" && profile.주소.trim()) data.address = profile.주소.trim();
    if (typeof profile.생년월일 === "string" && /^\d{4}-\d{2}-\d{2}$/.test(profile.생년월일)) data.birthDate = new Date(profile.생년월일);
    if (Object.keys(data).length) {
      try { await prisma.user.update({ where: { id: session.userId }, data }); }
      catch (e) { console.error("프로필 저장 오류:", e); }
    }
  }

  // 개인정보동의서 선택 항목(동의/미동의)·프로필 입력·직원 직접입력 필드 시 → 문서 재생성
  //
  // ⚠ 이 블록은 **계약 본문을 통째로 다시 만든다.** 그래서 세 가지를 반드시 먼저 본다
  //   (2026-09-04 검증에서 전부 빠져 있는 것이 드러났다):
  //   ① **지금 이 사람의 서명 차례인가** — 없으면 서명이 끝난 뒤에도 본문을 갈아치울 수 있었다.
  //   ② **아직 완료되지 않았는가** — 완료된 계약은 어떤 이유로도 본문이 바뀌면 안 된다.
  //   ③ **템플릿이 허용한 필드만인가** — fields 는 클라이언트가 준 임의 키였고, 서버가
  //      employeeFields/profileFields 를 한 번도 보지 않아 급여.기간 등 아무 칸이나 덮어썼다.
  const mySignStep = contract.approvalLine?.steps.find(
    (st) => st.approverId === session.userId && st.status === "PENDING"
  );
  const mayRewrite =
    !!mySignStep &&
    mySignStep.approverId === contract.userId &&
    contract.status !== "SIGNED" &&
    !contract.externalName;
  if ((consent || profile || fields) && contract.templateId && contract.userId === session.userId && !contract.externalName && mayRewrite) {
    try {
      // ⚠ employeeFields / profileFields 는 **Contract** 의 컬럼이다. 템플릿에서 select 하면
      //   Prisma 가 던지고 아래 catch 가 삼켜, 재생성이 **100% 조용히 죽는다**
      //   (2026-09-04 검증관 B 실측 — 주소.퇴사사유가 빈 채로 서명 완료되던 상태).
      //   `prisma: any` 라 타입 검사가 이 오타를 못 잡았다(F2, lib/db.ts).
      const tmpl = await prisma.contractTemplate.findUnique({
        where: { id: contract.templateId }, select: { fileUrl: true },
      });
      if (tmpl?.fileUrl.toLowerCase().endsWith(".docx")) {
        const prevExtra = (contract.extraFields as Record<string, string>) || {};
        // 템플릿이 "직원이 직접 입력한다"고 선언한 칸만 받는다. 동의 항목은 개인정보동의서의
        // 선택지라 별도로 허용하되, 역시 이미 있는 키(prevExtra)나 동의 접두로 제한한다.
        const allowed = new Set<string>([
          ...((Array.isArray(contract.employeeFields) ? contract.employeeFields : []) as string[]),
          ...((Array.isArray(contract.profileFields) ? contract.profileFields : []) as string[]),
        ]);
        const pick = (o: unknown, extra?: (k: string) => boolean) =>
          o && typeof o === "object"
            ? Object.fromEntries(Object.entries(o as Record<string, string>)
                .filter(([k]) => allowed.has(k) || (extra ? extra(k) : false)))
            : {};
        const merged = {
          ...prevExtra,
          // ⚠ 종전에는 `|| k in prevExtra` 탈출구가 있었다. 그러면 **계약에 이미 들어 있는
          //   모든 칸**(시급.근무시간.담당업무.계약구분…)을 직원이 서명하면서 덮어쓸 수 있다
          //   — 막겠다고 적어 둔 바로 그 부류다(2026-09-04 검증관 B 실측 변조 성공).
          //   개인정보동의서의 선택지만 통과시킨다.
          ...pick(consent, (k) => k.startsWith("동의")),
          ...pick(fields), // 퇴사일자·퇴사사유 등 직원 직접입력 — 템플릿이 허용한 칸만
        };
        const mergeData = await buildContractMergeData(contract.userId, {
          title: contract.title,
          startDate: contract.startDate ? contract.startDate.toISOString() : null,
          endDate: contract.endDate ? contract.endDate.toISOString() : null,
          // ⚠ null 로 두면 기본급.월급여합계.연봉총액 등이 빈칸으로 덮어써진다.
          //   다른 재생성 경로(PATCH.regenerate.번들발송)는 전부 extraFields 에서 복원한다.
          salary: ((prevExtra["연봉"] || "").replace(/[^0-9]/g, "")) || null,
          extraFields: merged,
        });
        const newUrl = await fillDocxTemplate(tmpl.fileUrl, mergeData);
        // **버전이 그대로일 때만** 쓴다(#206 검증 D3) — 재생성(약 1초) 사이 관리자가 내용을 고쳤으면(버전 증가)
        // 옛 입력으로 만든 문서가 새 문서를 덮게 두지 않는다.
        const w = await prisma.contract.updateMany({
          where: { id, version: contract.version },
          data: { fileUrl: JSON.stringify([newUrl]), extraFields: buildFieldSummary(null, merged) },
        });
        if (w.count === 0)
          return NextResponse.json({ code: "DOC_CHANGED", error: SIGN_FAIL.DOC_CHANGED }, { status: 409 });
      }
    } catch (e) {
      console.error("서명 시 문서 재생성 오류:", e);
    }
  }

  const approvalLine = contract.approvalLine;

  // 현재 사용자의 대기 중인 단계 찾기 (approval line 기반)
  const myStep = approvalLine?.steps.find(
    (step) => step.approverId === session.userId && step.status === "PENDING"
  );

  // 케이스 1: 직원이 서명할 번차 (승인라인의 순서 상 직원이 배정된 단계)
  // 외부 계약(externalName)은 소유자=작성 관리자 — 관리자 결재는 케이스 3(승인자)으로 처리
  if (myStep && myStep.approverId === contract.userId && !contract.externalName) {
    if (!signatureUrl) {
      return NextResponse.json({ error: "서명을 입력해주세요." }, { status: 400 });
    }

    // 서명 확정 — 찜·다음 단계·계약 갱신을 한 트랜잭션으로(#206 검증 D1, commitSign)
    const nextStep = approvalLine.steps.find((step) => step.order === myStep.order + 1);
    const r = await commitSign(id, myStep.id, nextStep?.id ?? null, signatureUrl, seenVersion, {
      employeeSignedAt: new Date(),
      status: !nextStep ? "SIGNED" : "APPROVED",
      signedAt: !nextStep ? new Date() : undefined,
    });
    if (!r.ok) return NextResponse.json({ code: r.code, error: SIGN_FAIL[r.code] }, { status: 409 });
    const updated = r.contract;
    // 감사 기록(#205-4) — 동의(#205-3)·서명·완료. 트랜잭션 밖, 실패해도 서명은 그대로
    await recordContractEvent({ contractId: id, type: "CONSENT", actorId: session.userId, actorName: session.name, stepOrder: myStep.order, request,
      meta: { text: SIGN_CONSENT_TEXT, readToEnd: typeof readToEnd === "boolean" ? readToEnd : null } });
    await recordContractEvent({ contractId: id, type: "SIGNED", actorId: session.userId, actorName: session.name, stepOrder: myStep.order, request,
      meta: { role: "근로자 본인", docVersion: contract.version } });
    if (!nextStep) await recordContractEvent({ contractId: id, type: "COMPLETED", actorId: session.userId, actorName: session.name, request });

    // 계약 완료 시 서명본(서명+직인 포함) 파일 생성·저장 → 뷰어·앱 완료본 보기에 사용
    if (!nextStep) {
      try {
        const { generateAndStoreSignedDoc } = await import("@/lib/signed-doc");
        await generateAndStoreSignedDoc(id);
      } catch (e) {
        // ⚠ 종전에는 console.error 로 끝났다. 컨테이너 로그는 아무도 안 보고, 계약은
        //   "완료"인데 원본 저장본만 없는 상태로 조용히 남는다(2026-09-04 검증관 A F1).
        //   시스템 로그에 남기면 관리자 화면에 뜨고, 매시 점검이 자가복구를 시도한다.
        console.error("서명본 저장 오류:", e);
        const { recordSignedDocFailure } = await import("@/lib/signed-doc-heal");
        await recordSignedDocFailure(id, e);
      }
    }

    // 이메일 알림 발송
    const appUrl = getAppUrl();
    if (nextStep?.approver?.email) {
      // 다음 승인자에게 알림
      await sendApprovalRequest(
        nextStep.approver.email,
        nextStep.approver.name,
        updated.title,
        updated.user.name,
        nextStep.order,
        appUrl,
        nextStep.approverId || undefined
      );
    } else if (!nextStep && updated.user.email) {
      // 계약 완료
      await sendContractCompletion(
        updated.user.email,
        updated.user.name,
        updated.title,
        updated.user.name,
        appUrl,
        updated.user.id // 본인 확인 관문(#140)
      );
    }

    // 봇 DM (개선 제안 2026-08-24): 다음 결재자에게 결재 요청, 없으면 완료 알림 (#136 재정리)
    if (nextStep?.approverId) {
      hrBotSendDM(nextStep.approverId, `🖋 전자계약 결재 요청\n「${updated.title}」 — 대상: ${contract.externalName || updated.user.name}\n아래 링크에서 바로 처리할 수 있습니다:\n${appUrl}${approvalPageUrl((nextStep as { approver?: { role?: string } }).approver?.role)}`).catch((e) => console.error("[contract] 결재 DM 오류:", e));
    } else if (!nextStep) {
      // 전체 완료 — 작성자 + 결재 참여 내부 결재자 전원 (근로자가 마지막 스텝이면 근로자 DM 생략) (#136)
      notifyContractCompleted(id).catch((e) => console.error("[contract] 완료 알림 오류:", e));
    }

    return NextResponse.json({ success: true, contract: updated });
  }

  // 케이스 2: 직원이 결재라인에 등록되지 않은 경우 (에러)
  if (!isApprover && contract.userId === session.userId && !myStep) {
    // 직원이 명시적으로 결재라인에 등록되지 않았으므로 에러
    return NextResponse.json(
      { error: "직원이 결재 단계에 등록되지 않았습니다. 발송 시 직원을 1,2,3단계 중 하나에 배치하세요." },
      { status: 400 }
    );
  }

  // 케이스 3: 승인자 승인 (myStep이 있고, approverId가 contract.userId가 아닌 경우)
  if (myStep) {
    if (!signatureUrl) {
      return NextResponse.json({ error: "서명을 입력해주세요." }, { status: 400 });
    }
    // 서명 확정 — 찜·다음 단계·계약 갱신을 한 트랜잭션으로(#206 검증 D1, commitSign). 없으면 계약 완료
    const nextStep = approvalLine.steps.find((step) => step.order === myStep.order + 1);
    const r = await commitSign(id, myStep.id, nextStep?.id ?? null, signatureUrl, seenVersion, {
      status: !nextStep ? "SIGNED" : "APPROVED",
      signedAt: !nextStep ? new Date() : undefined,
    });
    if (!r.ok) return NextResponse.json({ code: r.code, error: SIGN_FAIL[r.code] }, { status: 409 });
    const finalContract = r.contract;
    // 감사 기록(#205-4) — 결재 서명·완료
    await recordContractEvent({ contractId: id, type: "SIGNED", actorId: session.userId, actorName: session.name, stepOrder: myStep.order, request,
      meta: { role: "결재자", savedSignature: !!useSaved, docVersion: contract.version } });
    if (!nextStep) await recordContractEvent({ contractId: id, type: "COMPLETED", actorId: session.userId, actorName: session.name, request });

    // 계약 완료 시 서명본(서명+직인 포함) 파일 생성·저장 → 뷰어·앱 완료본 보기에 사용
    if (!nextStep) {
      try {
        const { generateAndStoreSignedDoc } = await import("@/lib/signed-doc");
        await generateAndStoreSignedDoc(id);
      } catch (e) {
        // ⚠ 종전에는 console.error 로 끝났다. 컨테이너 로그는 아무도 안 보고, 계약은
        //   "완료"인데 원본 저장본만 없는 상태로 조용히 남는다(2026-09-04 검증관 A F1).
        //   시스템 로그에 남기면 관리자 화면에 뜨고, 매시 점검이 자가복구를 시도한다.
        console.error("서명본 저장 오류:", e);
        const { recordSignedDocFailure } = await import("@/lib/signed-doc-heal");
        await recordSignedDocFailure(id, e);
      }
    }

    // 이메일 알림 발송
    const appUrl = getAppUrl();
    if (nextStep?.approver?.email) {
      // 다음 단계가 직원 서명인지 확인
      if (nextStep.approverId === finalContract.userId) {
        // 직원에게 서명 요청 알림
        await sendApprovalRequest(
          finalContract.user.email,
          finalContract.user.name,
          finalContract.title,
          finalContract.user.name,
          nextStep.order,
          appUrl,
          finalContract.user.id // 본인 확인 관문(#140)
        );
      } else if (nextStep.approver?.email) {
        // 다음 승인자에게 알림 (외부 서명 단계는 이메일 없음 — 관리자가 링크 전달)
        await sendApprovalRequest(
          nextStep.approver.email,
          nextStep.approver.name,
          finalContract.title,
          finalContract.user.name,
          nextStep.order,
          appUrl,
          nextStep.approverId || undefined // 본인 확인 관문(#140)
        );
      }
    } else if (!nextStep && finalContract.user.email) {
      // 계약 완료
      await sendContractCompletion(
        finalContract.user.email,
        finalContract.user.name,
        finalContract.title,
        finalContract.user.name,
        appUrl,
        finalContract.user.id // 본인 확인 관문(#140)
      );
    }

    // 봇 DM (개선 제안 2026-08-24): 다음 단계 담당자에게 알림, 없으면 완료 알림 (#136 재정리)
    if (nextStep) {
      if (nextStep.approverId) {
        const dm = nextStep.approverId === finalContract.userId && !contract.externalName
          ? `📝 전자계약 서명 요청\n「${finalContract.title}」\n앱 [더보기] → [계약서]에서 내용 확인 후 서명해 주세요.\n웹에서 바로 서명: ${appUrl}/contracts`
          : `🖋 전자계약 결재 요청\n「${finalContract.title}」 — 대상: ${contract.externalName || finalContract.user.name}\n아래 링크에서 바로 처리할 수 있습니다:\n${appUrl}${approvalPageUrl((nextStep as { approver?: { role?: string } }).approver?.role)}`;
        hrBotSendDM(nextStep.approverId, dm).catch((e) => console.error("[contract] 결재 DM 오류:", e));
      }
      // 중간 단계 결재 완료 → 작성자(createdBy)에게 진행 알림 (#136)
      // 마지막 단계는 아래 완료 알림이 대신한다. 작성자가 이 단계 결재자 본인이면 헬퍼가 생략.
      notifyStepApprovedToCreator({
        createdBy: contract.createdBy,
        approverId: session.userId,
        approverRole: myStep.approver?.role,
        order: myStep.order,
        title: finalContract.title,
        targetName: contract.externalName || finalContract.user.name,
      });
    } else {
      // 전체 완료 — 작성자 + 결재 참여 내부 결재자 전원 (근로자가 마지막 스텝이면 근로자 DM 생략) (#136)
      notifyContractCompleted(id).catch((e) => console.error("[contract] 완료 알림 오류:", e));
    }

    return NextResponse.json({ success: true, contract: finalContract });
  }

  // 어떤 경우도 해당하지 않음
  return NextResponse.json({ error: "처리할 수 있는 단계가 없습니다." }, { status: 403 });
}