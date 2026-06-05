"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { ChevronDown, LogOut } from "lucide-react";

interface Session {
  userId: string;
  name: string;
  email: string;
  role: "ADMIN" | "MANAGER" | "EMPLOYEE";
  branch?: string;
}

export function RoleSwitch() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    async function fetchSession() {
      try {
        const res = await fetch("/api/auth/me");
        if (res.ok) {
          const data = await res.json();
          setSession(data.session);
        }
      } catch (error) {
        console.error("Failed to fetch session:", error);
      } finally {
        setLoading(false);
      }
    }

    fetchSession();
  }, []);

  const handleSwitchRole = (targetRole: string) => {
    // Only ADMIN can switch roles
    if (session?.role !== "ADMIN") {
      return;
    }

    // Navigate to the appropriate dashboard based on target role
    const roleRoutes: Record<string, string> = {
      ADMIN: "/admin/dashboard",
      MANAGER: "/manager/dashboard",
      EMPLOYEE: "/dashboard",
    };

    const targetPath = roleRoutes[targetRole] || "/dashboard";
    router.push(targetPath);
  };

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  };

  if (loading || !session) {
    return null;
  }

  const canSwitchRoles = session.role === "ADMIN";
  const getRoleLabel = (role: string) => {
    switch (role) {
      case "ADMIN":
        return "관리자";
      case "MANAGER":
        return "원장";
      case "EMPLOYEE":
        return "직원";
      default:
        return role;
    }
  };

  const availableRoles =
    session.role === "ADMIN"
      ? ["ADMIN", "MANAGER", "EMPLOYEE"]
      : ["MANAGER", "EMPLOYEE"];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white border border-gray-300 hover:bg-gray-50 transition-colors">
          <span className="text-sm font-medium text-gray-700">
            {getRoleLabel(session.role)}
          </span>
          <ChevronDown size={16} className="text-gray-500" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {canSwitchRoles && (
          <>
            <DropdownMenuLabel className="text-xs text-gray-500 font-semibold">
              🔄 역할 전환 (테스트용)
            </DropdownMenuLabel>
            {availableRoles.map((role) => (
              <DropdownMenuItem
                key={role}
                onClick={() => handleSwitchRole(role)}
                className="cursor-pointer"
              >
                <span className="text-sm">
                  {role === session.role && "✓ "}
                  {getRoleLabel(role)}
                </span>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
          </>
        )}

        <div className="px-2 py-2 text-xs text-gray-600 border-t border-gray-200">
          <div className="font-semibold mb-1">현재 사용자</div>
          <div>{session.name}</div>
          <div className="text-gray-500">{session.email}</div>
        </div>

        <DropdownMenuSeparator />

        <DropdownMenuItem onClick={handleLogout} className="cursor-pointer text-red-600">
          <LogOut size={14} className="mr-2" />
          <span className="text-sm">로그아웃</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
