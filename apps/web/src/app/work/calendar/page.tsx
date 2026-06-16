import { CalendarDays } from "lucide-react";

export default function WorkCalendarPage() {
  return (
    <div className="max-w-3xl mx-auto p-8">
      <h1 className="text-2xl font-bold flex items-center gap-2 mb-6">
        <CalendarDays size={22} className="text-indigo-500" />캘린더
      </h1>
      <div className="bg-white border border-indigo-200 rounded-xl p-10 text-center">
        <CalendarDays size={40} className="mx-auto text-indigo-300 mb-3" />
        <p className="font-semibold text-gray-800">팀 캘린더 준비 중</p>
        <p className="text-sm text-gray-500 mt-2">
          팀 일정·회의·휴가를 한눈에 보는 공유 캘린더가 곧 추가됩니다.
        </p>
      </div>
    </div>
  );
}
