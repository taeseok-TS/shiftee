"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function TestAPIPage() {
  const [results, setResults] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(false);

  async function testEndpoint(endpoint: string, name: string) {
    try {
      setLoading(true);
      const res = await fetch(endpoint);
      const data = await res.json();

      setResults((prev) => ({
        ...prev,
        [name]: {
          status: res.status,
          ok: res.ok,
          data,
        },
      }));

      console.log(`[${name}] Status: ${res.status}`, data);
    } catch (error) {
      setResults((prev) => ({
        ...prev,
        [name]: {
          error: String(error),
        },
      }));

      console.error(`[${name}] Error:`, error);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">API 테스트</h1>
        <p className="text-gray-500">각 API 엔드포인트를 테스트하고 응답을 확인합니다</p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Button
          onClick={() =>
            testEndpoint("/api/debug/session", "Session Debug")
          }
          disabled={loading}
        >
          세션 확인
        </Button>

        <Button
          onClick={() =>
            testEndpoint("/api/employees", "Employees List")
          }
          disabled={loading}
        >
          직원 목록
        </Button>

        <Button
          onClick={() =>
            testEndpoint(
              "/api/employees/stats/active?period=month&date=2026-05",
              "Active Stats"
            )
          }
          disabled={loading}
        >
          재직자 현황
        </Button>

        <Button
          onClick={() =>
            testEndpoint("/api/employees/stats/resigned?year=2026", "Resigned Stats")
          }
          disabled={loading}
        >
          퇴직자 현황
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>테스트 결과</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {Object.entries(results).map(([name, result]: [string, any]) => (
            <div key={name} className="p-4 bg-gray-50 rounded-lg">
              <h3 className="font-semibold">{name}</h3>
              {result.status !== undefined && (
                <p className={result.ok ? "text-green-600" : "text-red-600"}>
                  Status: {result.status}
                </p>
              )}
              {result.error && <p className="text-red-600">Error: {result.error}</p>}
              {result.data && (
                <pre className="text-xs bg-white p-2 mt-2 rounded overflow-auto max-h-48">
                  {JSON.stringify(result.data, null, 2)}
                </pre>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      <p className="text-sm text-gray-500">
        브라우저 콘솔(F12)을 열어서 [Session Debug], [Active Stats] 등의 로그를 확인하세요.
      </p>
    </div>
  );
}
