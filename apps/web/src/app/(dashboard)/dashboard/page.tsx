import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Clock, Calendar, UmbrellaOff, FileSignature, Users, TrendingUp } from "lucide-react";
import { format } from "date-fns";
import { ko } from "date-fns/locale";

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

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

  const stats = [
    { title: "전체 직원", value: `${totalEmployees}명`, icon: Users, color: "text-blue-600", bg: "bg-blue-50" },
    { title: "오늘 출근", value: `${todayAttendance}명`, icon: Clock, color: "text-green-600", bg: "bg-green-50" },
    { title: "휴가 대기", value: `${pendingLeaves}건`, icon: UmbrellaOff, color: "text-orange-600", bg: "bg-orange-50" },
    { title: "계약 서명 대기", value: `${pendingContracts}건`, icon: FileSignature, color: "text-purple-600", bg: "bg-purple-50" },
  ];

  return (
    <div className="space-y-6">
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
        {stats.map(({ title, value, icon: Icon, color, bg }) => (
          <Card key={title}>
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
        ))}
      </div>

      {/* 최근 휴가 신청 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <TrendingUp size={18} />
            최근 휴가 신청
          </CardTitle>
        </CardHeader>
        <CardContent>
          {recentLeaves.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-4">대기 중인 휴가 신청이 없습니다.</p>
          ) : (
            <div className="space-y-3">
              {recentLeaves.map((leave) => (
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
  );
}
