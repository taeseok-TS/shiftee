"use strict";
/**
 * ============================================
 * Shiftee API - 공유 타입 정의
 * Web과 Mobile이 함께 사용하는 타입
 * ============================================
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ApiErrorClass = void 0;
class ApiErrorClass extends Error {
    constructor(status, message, code, details) {
        super(message);
        this.name = "ApiError";
        this.status = status;
        this.code = code;
        this.details = details;
    }
}
exports.ApiErrorClass = ApiErrorClass;
//# sourceMappingURL=index.js.map