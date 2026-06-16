import { Video } from "lucide-react";

export default function WorkMeetingPage() {
  return (
    <div className="max-w-3xl mx-auto p-8">
      <h1 className="text-2xl font-bold flex items-center gap-2 mb-6">
        <Video size={22} className="text-indigo-500" />화상회의
      </h1>
      <div className="bg-white border border-indigo-200 rounded-xl p-10 text-center">
        <Video size={40} className="mx-auto text-indigo-300 mb-3" />
        <p className="font-semibold text-gray-800">화상회의 준비 중</p>
        <p className="text-sm text-gray-500 mt-2">
          채팅·공지에 이어, 팀원과 바로 연결되는 화상회의 기능이 추가될 예정입니다.
        </p>
      </div>
    </div>
  );
}
