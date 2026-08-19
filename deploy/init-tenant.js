#!/usr/bin/env node
/**
 * 신규 고객사 초기화 — 관리자 계정 1개만 생성한다.
 *
 * prisma/seed.ts 는 개발용(더미 지점 3개 + 직원 50명)이라 판매 설치에 쓰면 안 된다.
 * 이 스크립트는 빈 DB에 딱 필요한 것만 만든다.
 *
 * 실행 (고객사 컨테이너 안에서):
 *   docker compose -p <code> exec -T web node /app/deploy/init-tenant.js \
 *     --email admin@example.com --name "관리자" --branch "본점"
 *
 * 비밀번호를 주지 않으면 무작위로 생성해 출력한다.
 */

const crypto = require("crypto");

/**
 * prisma·bcrypt 는 인자 검증을 통과한 뒤에 불러온다.
 * 최상단에서 require 하면 사용법 안내조차 못 띄우고,
 * 실행 위치를 잘못 잡았을 때 원인 모를 MODULE_NOT_FOUND 만 보게 된다.
 */
function loadDeps() {
  try {
    return {
      PrismaClient: require("@prisma/client").PrismaClient,
      bcrypt: require("bcryptjs"),
    };
  } catch (err) {
    console.error("✗ 의존성을 찾지 못했습니다:", err.message);
    console.error("  이 스크립트는 apps/web 안에서 실행해야 합니다 (pnpm 워크스페이스 구조).");
    console.error("  예: docker compose -p <code> exec -T web node init-tenant.js --email ...");
    process.exit(3);
  }
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    out[key] = next && !next.startsWith("--") ? (i++, next) : true;
  }
  return out;
}

/** 사람이 옮겨 적을 수 있게 헷갈리는 글자(0/O/1/l/I)는 뺀다. */
function generatePassword(length = 14) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  let out = "";
  while (out.length < length) {
    out += alphabet[crypto.randomInt(0, alphabet.length)];
  }
  return out + "!";
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const email = args.email;
  const name = args.name || "관리자";
  // 지점은 쉼표로 여러 개 받는다: --branch "본점,강남점,분당점"
  const branchNames = String(args.branch === true ? "" : args.branch || "")
    .split(",").map((b) => b.trim()).filter(Boolean);
  const password = args.password || generatePassword();

  if (!email || email === true) {
    console.error("사용법: node init-tenant.js --email <관리자이메일> [--name <이름>] [--branch '지점1,지점2'] [--password <비밀번호>]");
    process.exit(1);
  }

  const { PrismaClient, bcrypt } = loadDeps();
  const prisma = new PrismaClient();

  try {
    // 안전장치 — 이미 쓰고 있는 DB에 실수로 실행하는 것을 막는다.
    const existing = await prisma.user.count();
    if (existing > 0) {
      console.error(`중단: 이미 사용자 ${existing}명이 있는 DB입니다. 빈 DB에서만 실행하세요.`);
      console.error("       (정말 관리자만 추가하려면 관리자 화면에서 직원 등록을 쓰세요)");
      process.exit(2);
    }

    // 좌표는 서울시청 기본값. 출퇴근 판정에 쓰이므로 오픈 전에 실제 값으로 고쳐야 한다.
    const branches = [];
    for (const bn of branchNames) {
      branches.push(
        await prisma.branch.create({
          data: { name: bn, address: "", latitude: 37.5665, longitude: 126.978, radius: 200 },
        })
      );
    }
    const branch = branches[0] || null;

    const admin = await prisma.user.create({
      data: {
        email,
        password: await bcrypt.hash(password, 10),
        name,
        role: "ADMIN",
        branch: branch ? branch.name : null,
        department: "관리",
        jobGroup: "관리자",
        position: "시스템관리자",
      },
    });

    const line = "─".repeat(58);
    console.log(`\n${line}`);
    console.log("  초기화 완료");
    console.log(line);
    console.log(`  관리자 이메일 : ${admin.email}`);
    console.log(`  초기 비밀번호 : ${password}`);
    if (branches.length)
      console.log(
        `  지점 ${branches.length}개   : ${branches.map((b) => b.name).join(", ")}  ← 좌표는 관리자 화면에서 수정 필요`
      );
    console.log(line);
    console.log("  * 첫 로그인 후 비밀번호를 반드시 변경하세요.");
    console.log("  * 지점 좌표(위경도)와 반경은 출퇴근 판정에 쓰이므로 실제 값으로 고쳐야 합니다.\n");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("초기화 실패:", err.message);
  process.exit(1);
});
