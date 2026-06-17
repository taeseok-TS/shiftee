// 큐브티 모바일 — Metro 설정 (pnpm/npm 워크스페이스 모노레포 대응)
// @shiftee/api 등 워크스페이스 패키지를 번들러가 따라가도록 watchFolders + nodeModulesPaths 지정
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

// 워크스페이스 루트(및 packages/*)를 감시 대상에 포함
config.watchFolders = [workspaceRoot];

// 모듈 해석 경로: 앱 자체 node_modules + 루트 node_modules
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];

// 워크스페이스 패키지를 실제 경로로 직접 매핑
// (node_modules의 심볼릭링크가 C:\shiftee 정션 경로를 가리켜
//  watchFolder(실제 경로) 밖으로 인식되는 문제 회피)
config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules || {}),
  "@shiftee/api": path.resolve(workspaceRoot, "packages/api"),
};

module.exports = config;
