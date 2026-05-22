import Link from "next/link";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { normalizeBranchName } from "@/lib/branches";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Clock, Calendar, UmbrellaOff, FileSignature, Users, TrendingUp, AlertCircle, CheckCircle2, Home } from "lucide-react";
import { format, startOfWeek, eachDayOfInterval, isToday, isSameDay } from "date-fns";
import { ko } from "date-fns/locale";

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const isAdmin = session.role === "ADMIN";
  const isManager = session.role === "MANAGER";
  const isEmployee = session.role === "EMPLOYEE";

  // 기본 쿼리 (모든 역할)
  const [
    totalEmployees,
    todayAttendance,
    pendingLeaves,
    pendingContracts,
    recentLeaves,
    myTodayAttendance,
  ] = await Promise.all([
    prisma.user.count({ where: { isActive: true } }),
    prisma.attendance.count({ where: { date: today } }),
    prisma.leaveRequest.count({ where: { status: "PENDING" } }),
    prisma.contract.count({ where: { status: "SENT" } }),
    prisma.leaveRequest.findMany({
      take: 5,
      where: { status: "PENDING" },
      include: { user: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.attendance.findFirst({
      where: { userId: session.userId, date: today },
    }),
  ]);

  // EMPLOYEE 역할 전용 쿼리
  let myContracts: any[] = [];
  let myLeaveBalance = { total: 0, used: 0, remaining: 0 };
  let myPendingContracts = 0;
  let mySigningPendingContracts = 0;

  if (isEmployee) {
    const [
      contracts,
      leaveBalance,
    ] = await Promise.all([
      prisma.contract.findMany({
        where: {
          userId: session.userId,
          status: "SENT",
        },
        take: 5,
      }),
      prisma.leaveBalance.findFirst({
        where: { userId: session.userId, year: new Date().getFullYear() },
      }),
    ]);

    myContracts = contracts;
    myLeaveBalance = {
      total: leaveBalance?.total ?? 15,
      used: leaveBalance?.used ?? 0,
      remaining: leaveBalance?.remaining ?? 15,
    };

    mySigningPendingContracts = contracts.filter((c: any) => c.status === "SENT").length;
    myPendingContracts = 0;
  }

  // MANAGER/ADMIN 역할 전용 쿼리
  let teamStats = { total: 0, absent: 0, earlyLeave: 0, pendingApprovals: 0 };
  let recentPendingLeaves: any[] = [];
  let recentPendingContracts: any[] = [];

  if (isManager || isAdmin) {
    const managerBranch = isManager ? normalizeBranchName(session.branch) : null;
    let userWhereClause: any = { isActive: true };
    if (isManager && managerBranch) {
      userWhereClause.branch = managerBranch;
    }

    const [
      totalTeamEmployees,
      absentCount,
      earlyLeaveCount,
      pendingApprovalsCount,
      teamRecentLeaves,
      teamRecentContracts,
    ] = await Promise.all([
      prisma.user.count({ where: userWhereClause }),
      prisma.attendance.count({
        where: {
          date: today,
          status: "ABSENT",
          user: userWhereClause,
        },
      }),
      prisma.attendance.count({
        where: {
          date: today,
          status: "EARLY_LEAVE",
          user: userWhereClause,
        },
      }),
      prisma.leaveRequest.count({
        where: {
          status: "PENDING",
          user: userWhereClause,
        },
      }),
      prisma.leaveRequest.findMany({
        where: {
          status: "PENDING",
          user: userWhereClause,
        },
        include: { user: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
        take: 5,
      }),
      prisma.contract.findMany({
        where: {
          status: "SENT",
          user: userWhereClause,
        },
        include: { user: { select: { name: true } } },
        take: 5,
      }),
    ]);

    teamStats = {
      total: totalTeamEmployees,
      absent: absentCount,
      earlyLeave: earlyLeaveCount,
      pendingApprovals: pendingApprovalsCount,
    };
    recentPendingLeaves = teamRecentLeaves;
    recentPendingContracts = teamRecentContracts;
  }

  // 주간 출석 데이터 (현재 주)
  const weekStart = startOfWeek(today, { weekStartsOn: 1 });
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);
  weekEnd.setHours(23, 59, 59, 999);

  const weeklyAttendance = await prisma.attendance.findMany({
    where: {
      userId: session.userId,
      date: {
        gte: weekStart,
        lte: weekEnd,
      },
    },
  });

  const weekDays = eachDayOfInterval({ start: weekStart, end: weekEnd });

  const stats = [
    { title: "전체 직원", value: `${totalEmployees}명`, icon: Users, color: "text-blue-600", bg: "bg-blue-50" },
    { title: "오늘 출근", value: `${todayAttendance}명`, icon: Clock, color: "text-green-600", bg: "bg-green-50" },
    { title: "휴가 대기", value: `${pendingLeaves}건`, icon: UmbrellaOff, color: "text-orange-600", bg: "bg-orange-50" },
    { title: "계약 서명 대기", value: `${pendingContracts}건`, icon: FileSignature, color: "text-purple-600", bg: "bg-purple-50" },
  ];

  const getAttendanceStatus = (date: Date) => {
    const record = weeklyAttendance.find((a: any) => isSameDay(new Date(a.date), date));
    if (!record) return isToday(date) ? "예정" : "-";
    return record.status === "NORMAL" ? "정상" : record.status === "LATE" ? "지각" : record.status === "EARLY_LEAVE" ? "조기" : "결근";
  };

  const getAttendanceColor = (date: Date) => {
    const record = weeklyAttendance.find((a: any) => isSameDay(new Date(a.date), date));
    if (!record) return isToday(date) ? "bg-gray-100" : "bg-gray-50";
    switch (record.status) {
      case "NORMAL": return "bg-green-100";
      case "LATE": return "bg-yellow-100";
      case "EARLY_LEAVE": return "bg-orange-100";
      case "ABSENT": return "bg-red-100";
      default: return "bg-gray-100";
    }
  };

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">
          안녕하세요, {session.name}님 👋
        </h1>
        <p className="text-gray-500 mt-1">
          {format(new Date(), "yyyy년 MM월 dd일 (EEEE)", { locale: ko })}
        </p>
      </div>

      {/* 내 오늘 출퇴근 현황 */}
      <Card className="border-blue-200 bg-blue-50">
        <CardContent className="py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Clock className="text-blue-600" size={20} />
              <span className="font-medium text-blue-900">오늘 내 출퇴근</span>
            </div>
            <div className="flex items-center gap-4">
              <div className="text-sm text-blue-800">
                출근: <span className="font-semibold">{myTodayAttendance?.clockIn ? format(new Date(myTodayAttendance.clockIn), "HH:mm") : "-"}</span>
              </div>
              <div className="text-sm text-blue-800">
                퇴근: <span className="font-semibold">{myTodayAttendance?.clockOut ? format(new Date(myTodayAttendance.clockOut), "HH:mm") : "-"}</span>
              </div>
              {myTodayAttendance?.status && (
                <Badge variant={myTodayAttendance.status === "NORMAL" ? "default" : "destructive"}>
                  {myTodayAttendance.status === "NORMAL" ? "정상" :
                   myTodayAttendance.status === "LATE" ? "지각" :
                   myTodayAttendance.status === "EARLY_LEAVE" ? "조기퇴근" : myTodayAttendance.status}
                </Badge>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 통계 카드 */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map(({ title, value, icon: Icon, color, bg }) => {
          const links: Record<string, string> = {
            "전체 직원": "/employees",
            "오늘 출근": "/attendance",
            "휴가 대기": "/leave",
            "계약 서명 대기": "/contracts",
          };
          const href = links[title] || "#";

          return (
            <Link key={title} href={href}>
              <div className="cursor-pointer hover:shadow-lg transition-shadow h-full">
                <Card className="h-full">
                  <CardContent className="pt-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-gray-500">{title}</p>
                        <p className="text-2xl font-bold text-gray-900 mt-1">{value}</p>
                      </div>
                      <div className={`w-12 h-12 rounded-xl ${bg} flex items-center justify-center`}>
                        <Icon className={color} size={22} />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </Link>
          );
        })}
      </div>

      {/* EMPLOYEE 전용 위젯 */}
      {isEmployee && (
        <>
          {/* 내 계약서 현황 */}
          <Link href="/contracts">
            <div className="cursor-pointer hover:shadow-lg transition-shadow">
              <Card>
                <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <FileSignature size={18} />
                내 계약서 현황
              </CardTitle>
            </CardHeader>
            <CardContent>
              {myContracts.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-4">처리할 계약서가 없습니다.</p>
              ) : (
                <div className="space-y-3">
                  {myContracts.map((contract) => (
                    <div key={contract.id} className="flex items-center justify-between py-2 border-b last:border-0">
                      <div>
                        <p className="font-medium text-sm">{contract.title}</p>
                        <p className="text-xs text-gray-500">
                          {format(new Date(contract.createdAt), "MM/dd HH:mm")}
                        </p>
                      </div>
                      <Badge variant={contract.status === "SENT" ? "default" : "outline"} className={contract.status === "SENT" ? "bg-blue-600" : "text-orange-600 border-orange-200"}>
                        {contract.status === "SENT" ? "서명 대기" : "승인 대기"}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
                </CardContent>
              </Card>
            </div>
          </Link>

          {/* 내 휴가 잔여 */}
          <Link href="/leave">
            <div className="cursor-pointer hover:shadow-lg transition-shadow">
              <Card>
                <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <UmbrellaOff size={18} />
                휴가 현황 (2026년)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-4">
                <div className="bg-blue-50 p-4 rounded-lg text-center">
                  <p className="text-sm text-gray-600">총 휴가</p>
                  <p className="text-2xl font-bold text-blue-600 mt-1">{myLeaveBalance.total}일</p>
                </div>
                <div className="bg-orange-50 p-4 rounded-lg text-center">
                  <p className="text-sm text-gray-600">사용</p>
                  <p className="text-2xl font-bold text-orange-600 mt-1">{myLeaveBalance.used}일</p>
                </div>
                <div className="bg-green-50 p-4 rounded-lg text-center">
                  <p className="text-sm text-gray-600">잔여</p>
                  <p className="text-2xl font-bold text-green-600 mt-1">{myLeaveBalance.remaining}일</p>
                </div>
              </div>
                </CardContent>
              </Card>
            </div>
          </Link>
        </>
      )}

      {/* MANAGER/ADMIN 전용 위젯 */}
      {(isManager || isAdmin) && (
        <>
          {/* 팀 현황 */}
          <Card className="border-purple-200 bg-purple-50">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Users size={18} className="text-purple-600" />
                팀 현황
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <p className="text-sm text-gray-600">배치 직원</p>
                  <p className="text-2xl font-bold text-purple-600 mt-1">{teamStats.total}명</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">결근</p>
                  <p className="text-2xl font-bold text-red-600 mt-1">{teamStats.absent}명</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">조기퇴근</p>
                  <p className="text-2xl font-bold text-orange-600 mt-1">{teamStats.earlyLeave}명</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">결재 대기</p>
                  <p className="text-2xl font-bold text-blue-600 mt-1">{teamStats.pendingApprovals}건</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* 팀 휴가 신청 */}
          <Link href="/leave">
            <div className="cursor-pointer hover:shadow-lg transition-shadow">
              <Card>
                <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <UmbrellaOff size={18} />
                팀 휴가 신청 (대기중)
              </CardTitle>
            </CardHeader>
            <CardContent>
              {recentPendingLeaves.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-4">대기 중인 휴가 신청이 없습니다.</p>
              ) : (
                <div className="space-y-3">
                  {recentPendingLeaves.map((leave) => (
                    <div key={leave.id} className="flex items-center justify-between py-2 border-b last:border-0">
                      <div>
                        <p className="font-medium text-sm">{leave.user.name}</p>
                        <p className="text-xs text-gray-500">
                          {format(new Date(leave.startDate), "MM/dd")} ~ {format(new Date(leave.endDate), "MM/dd")} ({leave.days}일)
                        </p>
                      </div>
                      <Badge variant="outline" className="text-orange-600 border-orange-200">
                        {leave.type === "ANNUAL" ? "연차" :
                         leave.type === "HALF_AM" ? "오전반차" :
                         leave.type === "HALF_PM" ? "오후반차" :
                         leave.type === "SICK" ? "병가" : "특별휴가"}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
                </CardContent>
              </Card>
            </div>
          </Link>

          {/* 팀 계약서 서명 대기 */}
          <Link href="/contracts">
            <div className="cursor-pointer hover:shadow-lg transition-shadow">
              <Card>
                <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <FileSignature size={18} />
                팀 계약서 (서명 대기)
              </CardTitle>
            </CardHeader>
            <CardContent>
              {recentPendingContracts.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-4">서명 대기 중인 계약서가 없습니다.</p>
              ) : (
                <div className="space-y-3">
                  {recentPendingContracts.map((contract) => (
                    <div key={contract.id} className="flex items-center justify-between py-2 border-b last:border-0">
                      <div>
                        <p className="font-medium text-sm">{contract.user.name}</p>
                        <p className="text-xs text-gray-500">{contract.title}</p>
                      </div>
                      <Badge variant="default" className="bg-blue-600">
                        서명 대기
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
                </CardContent>
              </Card>
            </div>
          </Link>
        </>
      )}

      {/* 이번주 출석 현황 (모든 역할) */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Calendar size={18} />
            이번주 출석 현황
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-7 gap-2">
            {weekDays.map((date) => {
              const status = getAttendanceStatus(date);
              const color = getAttendanceColor(date);
              return (
                <div key={date.toISOString()} className={`p-3 rounded-lg ${color} text-center`}>
                  <p className="text-xs text-gray-600 font-medium">{format(date, "E", { locale: ko })}</p>
                  <p className="text-sm text-gray-700 font-semibold mt-1">{format(date, "dd")}</p>
                  <p className="text-xs text-gray-700 mt-1">{status}</p>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* 최근 휴가 신청 (전체) */}
      <Link href="/leave">
        <div className="cursor-pointer hover:shadow-lg transition-shadow">
          <Card>
            <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <AlertCircle size={18} />
            전사 휴가 신청 (대기중)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {recentLeaves.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-4">대기 중인 휴가 신청이 없습니다.</p>
          ) : (
            <div className="space-y-3">
              {recentLeaves.map((leave: any) => (
                <div key={leave.id} className="flex items-center justify-between py-2 border-b last:border-0">
                  <div>
                    <p className="font-medium text-sm">{leave.user.name}</p>
                    <p className="text-xs text-gray-500">
                      {format(new Date(leave.startDate), "MM/dd")} ~ {format(new Date(leave.endDate), "MM/dd")} ({leave.days}일)
                    </p>
                  </div>
                  <Badge variant="outline" className="text-orange-600 border-orange-200">
                    {leave.type === "ANNUAL" ? "연차" :
                     leave.type === "HALF_AM" ? "오전반차" :
                     leave.type === "HALF_PM" ? "오후반차" :
                     leave.type === "SICK" ? "병가" : "특별휴가"}
                  </Badge>
                </div>
              ))}
            </div>
          )}
            </CardContent>
          </Card>
        </div>
      </Link>
    </div>
  );
}
