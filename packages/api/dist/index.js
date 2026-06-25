"use strict";
/**
 * ============================================
 * Shiftee API - 메인 Export
 * ============================================
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getApiClient = exports.initializeApi = exports.ShifteeApiClient = void 0;
// 타입 export
__exportStar(require("./types/index"), exports);
// 클라이언트 export
var index_1 = require("./client/index");
Object.defineProperty(exports, "ShifteeApiClient", { enumerable: true, get: function () { return index_1.ShifteeApiClient; } });
Object.defineProperty(exports, "initializeApi", { enumerable: true, get: function () { return index_1.initializeApi; } });
Object.defineProperty(exports, "getApiClient", { enumerable: true, get: function () { return index_1.getApiClient; } });
//# sourceMappingURL=index.js.map