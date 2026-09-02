import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { filterContractData } from "@/lib/api-response";
import { getManagerBranches } from "@/lib/manager-branches";
import fs from "fs/promises";
import path from "path";
import { fillDocxTemplate, buildContractMergeData, buildFieldSummary, scanTemplateProfileFields, scanEmployeeFillFields } from "@/lib/contract-fields";
import type { Contract, CreateContractRequest } from "@shiftee/api";

export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const year = searchParams.get("year");
    const month = searchParams.get("month");
    const status = searchParams.get("status");
    const userId = searchParams.get("userId");
    const branch = searchParams.get("branch");
    const searchText = searchParams.get("searchText");
    const showHiddenRevoked = searchParams.get("showHiddenRevoked") === "true";

    // 본인 계약서만 조회: EMPLOYEE는 항상, 그 외 역할은 scope=self 요청 시
    const selfOnly = session.role === "EMPLOYEE" || searchParams.get("scope") === "self";

    // 기본 권한 필터
    const myBranches = session.role === "MANAGER" ? await getManagerBranches(session.userId) : [];
    let whereBase: any = selfOnly
      // 본인 계약만 — 외부 계약(externalName)은 소유자가 작성 관리자라 개인 화면에서는 제외
      ? { userId: session.userId, externalName: null }
      : session.role === "ADMIN"
      ? {}
      : session.role === "MANAGER"
      // 원장은 담당 지점 직원 계약서를 보되, 직원전용 문서(비밀유지·개인정보동의서)와
      // 외부 계약(소유자=작성 관리자 — 지점이 겹치면 딸려 나옴)은 제외. 결재 차례면 my-approvals로 보임
      ? { user: { branch: { in: myBranches } }, employeeOnly: false, externalName: null }
      : { userId: session.userId, externalName: null };

    // 추가 필터 적용
    if (year) {
      const yearNum = parseInt(year);
      const startOfYear = new Date(yearNum, 0, 1);
      const endOfYear = new Date(yearNum + 1, 0, 1);
      whereBase.createdAt = { gte: startOfYear, lt: endOfYear };
    }

    if (month && year) {
      const yearNum = parseInt(year);
      const monthNum = parseInt(month) - 1; // JS에서는 0부터 시작
      const startOfMonth = new Date(yearNum, monthNum, 1);
      const endOfMonth = new Date(yearNum, monthNum + 1, 1);
      whereBase.createdAt = { gte: startOfMonth, lt: endOfMonth };
    }

    if (status) {
      whereBase.status = status;
    }

    if (userId && !selfOnly) {
      whereBase.userId = userId;
    }

    // 지점 필터 — 계약 당사자(직원)의 소속 지점 기준. 외부 계약은 소유자가 관리자라 제외됨
    if (branch && !selfOnly) {
      whereBase.user = { ...(whereBase.user || {}), branch };
    }

    if (searchText && searchText.trim()) {
      whereBase.title = { contains: searchText.trim(), mode: "insensitive" };
    }
    // 문서 종류(템플릿)·패키지 여부 필터 (#135, 2026-08-27)
    const templateIdF = searchParams.get("templateId");
    if (templateIdF) whereBase.templateId = templateIdF;
    const pkg = searchParams.get("pkg");
    if (pkg === "bundle") whereBase.bundleId = { not: null };
    else if (pkg === "single") whereBase.bundleId = null;

    const contracts = await prisma.contract.findMany({
      where: whereBase,
      include: {
        user: { select: { id: true, name: true, email: true, department: true, branch: true } },
        template: { select: { postSignAccess: true } }, // 서명 완료 후 근로자 접근 (#129) — 완료본 버튼 게이트용
        approvalLine: {
          include: {
            steps: {
              include: { approver: { select: { id: true, name: true, email: true, branch: true } } },
              orderBy: { order: "asc" },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    // 데이터 필터링 적용: 직원 정보에서 이메일 제거 (부분 노출)
    const filteredContracts = contracts.map(({ template, ...contract }) => {
      const access = template?.postSignAccess || "full";
      // 열람 금지 문서는 파일 주소 자체를 내려주지 않는다 — 주소를 알면 다른 문(채팅 첨부 등)
      // 으로 빼돌리는 시도가 가능하고, 애초에 화면에서 쓸 일도 없다 (2026-09-02)
      const hideFiles = session.role !== "ADMIN" && access === "none" && contract.userId === session.userId;
      return ({
      ...contract,
      ...(hideFiles ? { fileUrl: null, signedUrl: null } : {}),
      // 서명 완료 후 근로자 접근 (#129) — 템플릿 미사용 계약은 기본 full
      postSignAccess: access,
      user: {
        id: contract.user.id,
        name: contract.user.name,
        department: contract.user.department,
        branch: contract.user.branch,
      },
      approvalLine: contract.approvalLine ? {
        ...contract.approvalLine,
        // signToken은 관리자(링크 복사 기능)에게만 — 원장·직원 응답에 실리면 게스트 서명 위조 가능
        steps: (contract.approvalLine.steps || []).map(({ signToken, tokenExpiresAt: _te, ...step }) => ({
          ...step,
          ...(session.role === "ADMIN" ? { signToken } : {}),
          // 외부(미가입) 서명 단계는 approver가 없음(null) — externalName으로 표시
          // 서명 이미지 주소는 본인 것만 — 남의 서명 PNG 를 받아 재사용하는 것을 막는다
          signatureUrl: session.role === "ADMIN" || step.approverId === session.userId ? step.signatureUrl : null,
          approver: step.approver ? {
            id: step.approver.id,
            name: step.approver.name,
            branch: step.approver.branch,
          } : null,
        })),
      } : null,
    });});

    return NextResponse.json({ contracts: filteredContracts });
  } catch (error) {
    console.error("GET /api/contracts 에러:", error);
    return NextResponse.json({ error: "계약서 조회에 실패했습니다." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session || session.role === "EMPLOYEE")
    return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });

  try {
    const formData = await request.formData();
    const files = formData.getAll("files") as File[];
    const templateId = formData.get("templateId") as string | null;
    const userId = formData.get("userId") as string;
    const title = formData.get("title") as string;
    const type = formData.get("type") as string;
    const startDate = formData.get("startDate") as string;
    const endDate = formData.get("endDate") as string;
    const salary = formData.get("salary") as string | null;
    const extraFieldsRaw = formData.get("extraFields") as string | null; // 템플릿별 동적 입력란 값(JSON)
    // 외부(미가입) 계약자 — 이름·연락처를 관리자가 직접 입력, 계약 소유자는 작성 관리자
    const externalName = ((formData.get("externalName") as string) || "").trim() || null;
    const externalPhone = ((formData.get("externalPhone") as string) || "").trim() || null;
    const effectiveUserId = externalName ? session.userId : userId;
    if (externalName && session.role !== "ADMIN")
      return NextResponse.json({ error: "외부 계약은 관리자만 작성할 수 있습니다." }, { status: 403 });

    // 템플릿 없을 때는 파일 필수, 템플릿 있을 때는 파일 불필수
    if ((files.length === 0 && !templateId) || !effectiveUserId || !title || !type)
      return NextResponse.json(
        { error: "필수 정보가 누락되었습니다." },
        { status: 400 }
      );

    // MANAGER의 지점 검증: 자신의 담당 지점(대표+겸직) 직원만 계약서 생성 가능
    if (session.role === "MANAGER") {
      const myBranches = await getManagerBranches(session.userId);
      const targetUser = await prisma.user.findUnique({
        where: { id: userId },
        select: { branch: true }
      });
      if (!targetUser || !targetUser.branch || !myBranches.includes(targetUser.branch)) {
        return NextResponse.json({ error: "자신의 지점 직원만 계약서를 생성할 수 있습니다." }, { status: 403 });
      }
    }

    let fileUrl = "";
    let contractProfileFields: string[] = [];
    let contractEmployeeFields: string[] = [];

    if (files.length > 0) {
      const fileUrls: string[] = [];

      for (const file of files) {
        try {
          const bytes = await file.arrayBuffer();
          const buffer = Buffer.from(bytes);
          const timestamp = Date.now();
          const filename = `${timestamp}-${Math.random().toString(36).substr(2, 9)}-${file.name.replace(/[^a-zA-Z0-9.-]/g, "_")}`;
          const dir = path.join(process.cwd(), "uploads", "contracts");
          console.log("파일 저장 경로:", dir);
          console.log("파일명:", filename);
          await fs.mkdir(dir, { recursive: true });
          await fs.writeFile(path.join(dir, filename), buffer);
          console.log("파일 저장 성공:", filename);
          fileUrls.push(`/api/uploads/contracts/${filename}`);
        } catch (fileError) {
          console.error("파일 저장 중 에러:", fileError);
          throw fileError;
        }
      }

      // fileUrl에 JSON 배열로 저장 (첫 번째 파일을 기본값으로 사용)
      fileUrl = JSON.stringify(fileUrls);
    } else if (templateId) {
      // 템플릿에서 파일 URL 가져오기
      const template = await prisma.contractTemplate.findUnique({
        where: { id: templateId },
      });
      if (!template) {
        return NextResponse.json({ error: "템플릿을 찾을 수 없습니다." }, { status: 404 });
      }

      if (template.fileUrl.toLowerCase().endsWith(".docx")) {
        // 이 계약서가 쓰는 프로필 필드(주소/생년월일) + 직원 직접입력 필드(퇴사일자 등) 기록
        contractProfileFields = await scanTemplateProfileFields(template.fileUrl);
        contractEmployeeFields = await scanEmployeeFillFields(template.fileUrl);
        // 워드 템플릿: 치환 필드({직원명}, {연봉} 등)를 입력값으로 채워 계약서 생성
        let parsedExtra: Record<string, string> | null = null;
        if (extraFieldsRaw) {
          try { parsedExtra = JSON.parse(extraFieldsRaw); } catch { /* 형식 오류는 무시 */ }
        }
        const mergeData = await buildContractMergeData(effectiveUserId, {
          title, startDate, endDate, salary, extraFields: parsedExtra,
          external: externalName ? { name: externalName, phone: externalPhone } : null,
        });
        try {
          const filledUrl = await fillDocxTemplate(template.fileUrl, mergeData);
          fileUrl = JSON.stringify([filledUrl]);
        } catch (e) {
          console.error("워드 템플릿 치환 오류:", e);
          return NextResponse.json(
            { error: "워드 템플릿 처리 중 오류가 발생했습니다. 템플릿의 치환 필드({직원명} 등) 형식을 확인해주세요." },
            { status: 400 }
          );
        }
      } else {
        fileUrl = JSON.stringify([template.fileUrl]);
      }
    }

    // 작성 시 입력값 요약 저장 (결재 승인 창에서 계약서를 안 열어도 확인 가능)
    let summaryExtra: Record<string, string> | null = null;
    if (extraFieldsRaw) {
      try { summaryExtra = JSON.parse(extraFieldsRaw); } catch { /* 무시 */ }
    }
    const fieldSummary = buildFieldSummary(salary, summaryExtra);

    const contract = await prisma.contract.create({
      data: {
        userId: effectiveUserId,
        createdBy: session.userId, // 작성자 — 단계·완료 알림 대상 (#136)
        externalName: externalName || undefined,
        externalPhone: externalPhone || undefined,
        title,
        type,
        fileUrl,
        templateId: templateId || undefined, // 수정 시 문서 재생성에 필요
        startDate: startDate ? new Date(startDate) : null,
        endDate: endDate ? new Date(endDate) : null,
        extraFields: Object.keys(fieldSummary).length ? fieldSummary : undefined,
        profileFields: contractProfileFields.length ? contractProfileFields : undefined,
        employeeFields: contractEmployeeFields.length ? contractEmployeeFields : undefined,
        status: "DRAFT",
      },
      include: {
        user: { select: { id: true, name: true, email: true, department: true, branch: true } },
        approvalLine: {
          include: {
            steps: {
              include: { approver: { select: { id: true, name: true, branch: true } } },
              orderBy: { order: "asc" },
            },
          },
        },
      },
    });

    return NextResponse.json({ success: true, contract });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "파일 업로드에 실패했습니다." }, { status: 500 });
  }
}