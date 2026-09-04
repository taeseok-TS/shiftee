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
  const { signatureData, isApprover, consent, profile, fields, useSaved, saveAsDefault } = body;
  // 저장된 본인 서명 사용 — 매번 그리지 않고 재사용 (직원 포함, 개선 제안 #75)
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

  const contract = await prisma.contract.findUnique({
    where: { id },
    include: { approvalLine: { include: { steps: { orderBy: { order: "asc" }, include: { approver: true } } } } },
  });

  if (!contract) return NextResponse.json({ error: "계약서를 찾을 수 없습니다." }, { status: 404 });

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
      const tmpl = await prisma.contractTemplate.findUnique({
        where: { id: contract.templateId }, select: { fileUrl: true, employeeFields: true, profileFields: true },
      });
      if (tmpl?.fileUrl.toLowerCase().endsWith(".docx")) {
        const prevExtra = (contract.extraFields as Record<string, string>) || {};
        // 템플릿이 "직원이 직접 입력한다"고 선언한 칸만 받는다. 동의 항목은 개인정보동의서의
        // 선택지라 별도로 허용하되, 역시 이미 있는 키(prevExtra)나 동의 접두로 제한한다.
        const allowed = new Set<string>([
          ...((Array.isArray(tmpl.employeeFields) ? tmpl.employeeFields : []) as string[]),
          ...((Array.isArray(tmpl.profileFields) ? tmpl.profileFields : []) as string[]),
        ]);
        const pick = (o: unknown, extra?: (k: string) => boolean) =>
          o && typeof o === "object"
            ? Object.fromEntries(Object.entries(o as Record<string, string>)
                .filter(([k]) => allowed.has(k) || (extra ? extra(k) : false)))
            : {};
        const merged = {
          ...prevExtra,
          ...pick(consent, (k) => k.startsWith("동의") || k in prevExtra),
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
        await prisma.contract.update({
          where: { id },
          data: { fileUrl: JSON.stringify([newUrl]), extraFields: buildFieldSummary(null, merged) },
        });
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

    // 현재 단계(직원 서명)를 APPROVED로 변경
    await prisma.contractApprovalStep.update({
      where: { id: myStep.id },
      data: { status: "APPROVED", decidedAt: new Date(), signatureUrl },
    });

    // 다음 단계가 있으면 PENDING으로 변경
    const nextStep = approvalLine.steps.find((step) => step.order === myStep.order + 1);
    if (nextStep) {
      await prisma.contractApprovalStep.update({
        where: { id: nextStep.id },
        data: { status: "PENDING" },
      });
    }

    const updated = await prisma.contract.update({
      where: { id },
      data: {
        employeeSignedAt: new Date(),
        status: !nextStep ? "SIGNED" : "APPROVED",
        signedAt: !nextStep ? new Date() : undefined,
      },
      include: {
        user: { select: { id: true, name: true, email: true } },
        approvalLine: {
          include: {
            steps: {
              include: { approver: { select: { id: true, name: true, email: true, role: true } } },
            },
          },
        },
      },
    });

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
    // 현재 단계 승인으로 변경
    await prisma.contractApprovalStep.update({
      where: { id: myStep.id },
      data: { status: "APPROVED", decidedAt: new Date(), signatureUrl },
    });

    // 다음 단계가 있으면 PENDING으로, 없으면 계약 완료
    const nextStep = approvalLine.steps.find((step) => step.order === myStep.order + 1);
    if (nextStep) {
      await prisma.contractApprovalStep.update({
        where: { id: nextStep.id },
        data: { status: "PENDING" },
      });
    }

    const finalContract = await prisma.contract.update({
      where: { id },
      data: {
        status: !nextStep ? "SIGNED" : "APPROVED",
        signedAt: !nextStep ? new Date() : undefined,
      },
      include: {
        user: { select: { id: true, name: true, email: true } },
        approvalLine: {
          include: {
            steps: {
              include: { approver: { select: { id: true, name: true, email: true, role: true } } },
            },
          },
        },
      },
    });

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
          ? `📝 전자계약 서명 요청\n「${finalContract.title}」\n앱 하단 [전자계약]에서 내용 확인 후 서명해 주세요.\n웹에서 바로 서명: ${appUrl}/contracts`
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