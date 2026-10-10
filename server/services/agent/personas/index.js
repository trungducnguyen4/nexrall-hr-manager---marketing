/**
 * Persona Strategy Dispatcher & System Prompt Assembler
 */
import { buildDirectorPrompt } from './director.persona.js';
import { buildHrPrompt } from './hr.persona.js';
import { buildEmployeePrompt } from './employee.persona.js';

export { resolveUserPersona, checkRolePermissions } from './persona-resolver.js';

const personaStrategies = {
  director: buildDirectorPrompt,
  hr: buildHrPrompt,
  employee: buildEmployeePrompt
};

/**
 * Build dynamic role-tailored System Prompt according to persona
 */
export function buildPersonaSystemPrompt(persona, me, nowFormatted, currentYear, ragResult, toolData, actionCard) {
  const strategy = personaStrategies[persona] || personaStrategies.employee;
  let prompt = strategy({ me, nowFormatted, currentYear });

  // Common system modules info
  prompt += `\n\nDANH MỤC 12 PHÂN HỆ HỆ THỐNG:
1. Dashboard | 2. Thông báo | 3. Chat nội bộ | 4. Chấm công (GPS 08:30-17:00, mốc 08:35, từ 08:36 tính muộn) | 5. Nghỉ phép (12 ngày/năm, duyệt 2 bước) | 6. Tasks | 7. Phiếu lương | 8. Bàn giao | 9. Nhân sự | 10. Bảng lương | 11. Địa điểm | 12. Cài đặt.`;

  if (ragResult && ragResult.contextText) {
    prompt += `\n\n--- TÀI LIỆU TRI THỨC NỘI QUY TRÍCH XUẤT (RAG CONTEXT) ---\n${ragResult.contextText}\n----------------------------------------------------\n`;
  }

  if (toolData && !actionCard) {
    prompt += `\n\n--- DỮ LIỆU THỰC TẾ HỆ THỐNG TRÍCH XUẤT (TOOL DATA) ---\n${JSON.stringify(toolData, null, 2)}\n----------------------------------------------------\n`;
  }

  prompt += `\n\nQUY TẮC BẢO ĐẢM TÍNH XÁC THỰC CỦA DỮ LIỆU (CHỐNG ẢO GIÁC - ZERO MOCK DATA):
1. BẮT BUỘC SỬ DỤNG DỮ LIỆU THẬT TỪ HỆ THỐNG: Mọi số liệu, họ tên nhân sự, mã nhân viên, phòng ban, số ngày nghỉ, số lần đi trễ BẮT BUỘC phải lấy 100% từ mục [TOOL DATA] ở trên nếu có.
2. TUYỆT ĐỐI KHÔNG TỰ BỊA ĐẶT / PLACEHOLDER: Nghiêm cấm tự bịa tên nhân viên giả lập như "Nguyễn Văn A", "Trần Văn B", "NV001", "NV002"... Nếu [TOOL DATA] ghi nhận nhân sự nào (ví dụ Phạm Hoàng Anh, Nguyễn Duy Vĩnh Sơn), BẮT BUỘC trả lời chính xác thông tin của nhân sự đó.
3. KHI KHÔNG CÓ DỮ LIỆU HOẶC KHÔNG TÌM THẤY: Hãy trả lời trung thực: "Hệ thống hiện tại chưa ghi nhận dữ liệu trong khoảng thời gian này." Tuyệt đối không tự suy diễn hoặc dựng dữ liệu mẫu.`;

  return prompt;
}
