const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

(async () => {
  try {
    // 퇴직 상태인 직원 ID 조회
    const resignedUsers = await prisma.user.findMany({
      where: {
        isActive: false,
        deletedAt: null
      },
      select: { id: true, name: true, email: true }
    });

    console.log("=== 삭제할 퇴직자 목록 ===");
    console.log(`총 ${resignedUsers.length}명\n`);
    resignedUsers.forEach(user => {
      console.log(`- ${user.name} (${user.email})`);
    });
    console.log("");

    const userIds = resignedUsers.map(u => u.id);

    if (userIds.length > 0) {
      // 연관된 모든 데이터 삭제 (순서 중요!)
      console.log("📋 관련 데이터 정리 중...\n");

      // LeaveApprovalStep 삭제
      const deleteLeaveApprovalStep = await prisma.leaveApprovalStep.deleteMany({
        where: { approverId: { in: userIds } }
      });
      console.log(`✅ LeaveApprovalStep ${deleteLeaveApprovalStep.count}개 삭제`);

      // ContractApprovalStep 삭제
      const deleteContractApprovalStep = await prisma.contractApprovalStep.deleteMany({
        where: { approverId: { in: userIds } }
      });
      console.log(`✅ ContractApprovalStep ${deleteContractApprovalStep.count}개 삭제`);

      // LeaveBalance 삭제
      const deleteLeaveBalance = await prisma.leaveBalance.deleteMany({
        where: { userId: { in: userIds } }
      });
      console.log(`✅ LeaveBalance ${deleteLeaveBalance.count}개 삭제`);

      // LeaveRequest 삭제 (approver로도 참조될 수 있음)
      const deleteLeaveRequest = await prisma.leaveRequest.deleteMany({
        where: {
          OR: [
            { userId: { in: userIds } },
            { approverId: { in: userIds } }
          ]
        }
      });
      console.log(`✅ LeaveRequest ${deleteLeaveRequest.count}개 삭제`);

      // ApprovalLine 삭제
      const deleteApprovalLine = await prisma.approvalLine.deleteMany({
        where: { userId: { in: userIds } }
      });
      console.log(`✅ ApprovalLine ${deleteApprovalLine.count}개 삭제`);

      // Attendance 삭제
      const deleteAttendance = await prisma.attendance.deleteMany({
        where: { userId: { in: userIds } }
      });
      console.log(`✅ Attendance ${deleteAttendance.count}개 삭제`);

      // Schedule 삭제
      const deleteSchedule = await prisma.schedule.deleteMany({
        where: { userId: { in: userIds } }
      });
      console.log(`✅ Schedule ${deleteSchedule.count}개 삭제`);

      // Contract 삭제
      const deleteContract = await prisma.contract.deleteMany({
        where: { userId: { in: userIds } }
      });
      console.log(`✅ Contract ${deleteContract.count}개 삭제`);

      console.log("");

      // User 삭제
      const deleteUsers = await prisma.user.deleteMany({
        where: { id: { in: userIds } }
      });
      console.log(`✅ User ${deleteUsers.count}명 삭제\n`);

      console.log("🎉 모든 퇴직자 데이터 정리 완료!");
    } else {
      console.log("삭제할 퇴직자가 없습니다.");
    }

  } catch (error) {
    console.error("❌ 에러:", error.message);
  } finally {
    await prisma.$disconnect();
  }
})();
