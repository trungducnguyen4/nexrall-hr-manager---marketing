import fs from "node:fs/promises";
import { Presentation, PresentationFile } from "@oai/artifact-tool";

const OUT_DIR = "D:/NetVietTv/nexrall-hr-manager---marketing/outputs/role-permissions-deck";
const TMP_DIR = "D:/NetVietTv/nexrall-hr-manager---marketing/work/presentations/role-permissions/tmp";
const FINAL = `${OUT_DIR}/phan-quyen-vai-tro-hr-platform.pptx`;

const W = 1280;
const H = 720;
const C = {
  ink: "#0B1220",
  muted: "#5E6675",
  panel: "#F2F4F7",
  panel2: "#E8EDF3",
  rule: "#C6CBD3",
  accent: "#3D8DFF",
  accentLight: "#D8F0FC",
  green: "#0F9F6E",
  amber: "#B7791F",
  red: "#C53030",
  white: "#FFFFFF",
};

const presentation = Presentation.create({ slideSize: { width: W, height: H } });

function addText(slide, text, x, y, w, h, opts = {}) {
  const box = slide.shapes.add({
    geometry: "textbox",
    position: { left: x, top: y, width: w, height: h },
    fill: "none",
    line: { style: "solid", fill: "none", width: 0 },
  });
  box.text = text;
  box.text.style = {
    fontSize: opts.size ?? 20,
    bold: opts.bold ?? false,
    color: opts.color ?? C.ink,
    alignment: opts.align ?? "left",
  };
  return box;
}

function addBox(slide, x, y, w, h, opts = {}) {
  return slide.shapes.add({
    geometry: opts.geometry ?? "rect",
    position: { left: x, top: y, width: w, height: h },
    fill: opts.fill ?? C.panel,
    line: { style: "solid", fill: opts.line ?? C.rule, width: opts.lineWidth ?? 1 },
  });
}

function addRule(slide, x, y, w, color = C.rule) {
  addBox(slide, x, y, w, 1.2, { fill: color, line: color, lineWidth: 0 });
}

function addHeader(slide, kicker, title, page) {
  slide.background.fill = C.white;
  addText(slide, kicker, 42, 28, 520, 28, { size: 13, bold: true, color: C.muted });
  addText(slide, title, 42, 58, 1050, 76, { size: 37, bold: true });
  addText(slide, String(page).padStart(2, "0"), 1184, 658, 54, 24, { size: 12, color: C.muted, align: "right" });
  addRule(slide, 42, 142, 1196);
}

function bulletList(slide, items, x, y, w, lineH = 31, opts = {}) {
  items.forEach((item, i) => {
    addText(slide, "•", x, y + i * lineH, 22, lineH, { size: opts.size ?? 18, color: opts.dotColor ?? C.accent, bold: true });
    addText(slide, item, x + 24, y + i * lineH, w - 24, lineH + 6, { size: opts.size ?? 18, color: opts.color ?? C.ink });
  });
}

function miniLabel(slide, label, x, y, w, fill = C.accentLight, color = C.ink) {
  addBox(slide, x, y, w, 28, { fill, line: fill, lineWidth: 0 });
  addText(slide, label, x + 10, y + 6, w - 20, 18, { size: 12, bold: true, color });
}

function roleCard(slide, title, subtitle, bullets, x, y, w, accent) {
  addBox(slide, x, y, w, 360, { fill: C.panel, line: "#D7DCE4" });
  addBox(slide, x, y, w, 7, { fill: accent, line: accent, lineWidth: 0 });
  addText(slide, title, x + 24, y + 28, w - 48, 40, { size: 26, bold: true });
  addText(slide, subtitle, x + 24, y + 70, w - 48, 52, { size: 16, color: C.muted });
  bulletList(slide, bullets, x + 24, y + 138, w - 48, 42, { size: 17, dotColor: accent });
}

function table(slide, rows, x, y, colWidths, rowH, opts = {}) {
  const totalW = colWidths.reduce((a, b) => a + b, 0);
  rows.forEach((row, r) => {
    const fill = r === 0 ? C.ink : (r % 2 ? C.white : "#F8FAFC");
    addBox(slide, x, y + r * rowH, totalW, rowH, { fill, line: "#D7DCE4" });
    let cx = x;
    row.forEach((cell, c) => {
      if (c > 0) addRule(slide, cx, y + r * rowH, rowH, "#D7DCE4");
      addText(slide, String(cell), cx + 10, y + r * rowH + 8, colWidths[c] - 20, rowH - 12, {
        size: r === 0 ? (opts.headerSize ?? 14) : (opts.size ?? 13),
        bold: r === 0 || c === 0,
        color: r === 0 ? C.white : C.ink,
        align: c > 0 && opts.center ? "center" : "left",
      });
      cx += colWidths[c];
    });
  });
}

// Slide 1
{
  const slide = presentation.slides.add();
  slide.background.fill = C.white;
  addText(slide, "NEXRALL HR PLATFORM", 42, 36, 520, 28, { size: 13, bold: true, color: C.muted });
  addText(slide, "Phân quyền vai trò trong hệ thống HR", 42, 155, 850, 112, { size: 54, bold: true });
  addText(slide, "Tài liệu tóm tắt chức năng cho Nhân viên / Thực tập sinh, Nhân sự và Admin (Anh Hậu), dựa trên route guard và UI hiện tại của dự án.", 42, 292, 850, 74, { size: 22, color: C.muted });
  addBox(slide, 42, 470, 356, 92, { fill: C.panel, line: C.panel });
  addText(slide, "3 nhóm vai trò", 66, 493, 300, 28, { size: 22, bold: true });
  addText(slide, "Self-service → Vận hành HR → Toàn quyền hệ thống", 66, 526, 300, 24, { size: 15, color: C.muted });
  addBox(slide, 930, 0, 308, 720, { fill: C.panel, line: C.panel, lineWidth: 0 });
  addText(slide, "Nguồn: server.js, src/views/*.js\nNgày lập: 23/07/2026", 966, 566, 220, 68, { size: 15, color: C.muted });
  addText(slide, "01", 1184, 658, 54, 24, { size: 12, color: C.muted, align: "right" });
}

// Slide 2
{
  const slide = presentation.slides.add();
  addHeader(slide, "ROLE MODEL", "Ba tầng quyền: tự phục vụ, vận hành nhân sự, quản trị hệ thống", 2);
  roleCard(slide, "Nhân viên / TTS", "Người dùng nghiệp vụ: thao tác trên dữ liệu cá nhân và công việc liên quan.", [
    "Chấm công, đăng ký ca / hình thức làm việc",
    "Tạo và theo dõi đơn nghỉ phép của bản thân",
    "Xem / xác nhận phiếu lương của bản thân",
    "Xử lý task được giao hoặc do mình tạo",
    "TTS xác nhận hoặc yêu cầu xem lại đánh giá",
  ], 42, 190, 360, C.accent);
  roleCard(slide, "Nhân sự", "Vai trò vận hành: theo dõi, tổng hợp và xử lý nghiệp vụ HR cho nhân sự.", [
    "Xem danh sách nhân viên, chấm công, nghỉ phép",
    "Tạo / xử lý phiếu lương, yêu cầu xem lại lương",
    "Quản lý phòng ban, tuyển dụng, chiến dịch MKT",
    "Quản lý tài sản trong phạm vi được phép",
    "Một số luồng yêu cầu thuộc Phòng HCNS",
  ], 460, 190, 360, C.green);
  roleCard(slide, "Admin / Anh Hậu", "Vai trò chủ hệ thống: bao phủ quyền Nhân sự và thêm lớp cấu hình / dữ liệu.", [
    "Toàn quyền nghiệp vụ như Nhân sự",
    "Cấu hình công ty, WiFi whitelist, Database Admin",
    "Khóa / mở khóa, sửa, reset mật khẩu, xóa user",
    "Có quyền HCNS và Ban Giám Đốc trong workflow",
    "Xem toàn bộ task và dữ liệu quản trị",
  ], 878, 190, 360, C.red);
}

// Slide 3
{
  const slide = presentation.slides.add();
  addHeader(slide, "PERMISSION MATRIX", "Ma trận quyền theo module cho thấy Admin là lớp mở rộng của Nhân sự", 3);
  const rows = [
    ["Module", "Nhân viên / TTS", "Nhân sự", "Admin / Anh Hậu"],
    ["Dashboard", "Xem dữ liệu cá nhân", "Xem chỉ số đội / công ty", "Xem toàn bộ"],
    ["Chấm công", "Đăng ký, check-in/out", "Xem / sửa dữ liệu", "Xem / sửa toàn bộ"],
    ["Nghỉ phép", "Tạo, xem đơn của mình", "Duyệt / cập nhật đơn", "Duyệt + cấu hình loại nghỉ"],
    ["Công việc", "Task liên quan", "Quản lý nếu HCNS / liên quan", "Xem toàn bộ, quản trị"],
    ["Tài sản", "Khai báo / xem của mình", "Theo dõi phòng ban / HCNS", "Toàn quyền + audit credential"],
    ["Phiếu lương", "Xem, xác nhận, yêu cầu xem lại", "Tạo, sửa, xử lý review", "Toàn quyền + khóa dữ liệu"],
    ["Nhân viên / phòng ban", "Không truy cập quản trị", "Xem / vận hành HR", "Sửa user, khóa, reset, xóa"],
    ["Đánh giá hiệu suất", "TTS xác nhận / phản hồi", "HCNS phân công, nhận, khóa", "Phê duyệt như BGD + HCNS"],
    ["Hệ thống", "Không", "Không / hạn chế", "Settings, WiFi, DB Admin"],
  ];
  table(slide, rows, 42, 170, [252, 275, 275, 275], 46, { size: 12.5, headerSize: 13, center: false });
  addText(slide, "Ghi chú: trong code, role='manager' được dùng cho Nhân sự; một số quyền chuyên biệt vẫn kiểm theo department như Phòng HCNS hoặc Ban Giám Đốc.", 42, 642, 1060, 32, { size: 14, color: C.muted });
}

// Slide 4
{
  const slide = presentation.slides.add();
  addHeader(slide, "EMPLOYEE / INTERN", "Nhân viên và TTS chủ yếu thao tác trên phạm vi cá nhân", 4);
  addText(slide, "Công việc chính", 42, 174, 360, 30, { size: 26, bold: true });
  bulletList(slide, [
    "Đăng ký hình thức làm việc và chấm công theo ngày.",
    "Gửi đơn nghỉ phép, chỉnh / xóa khi còn phù hợp với workflow.",
    "Tạo task, cập nhật task được giao hoặc do mình tạo.",
    "Xem phiếu lương đã phát hành, xác nhận hoặc yêu cầu xem lại.",
    "Khai báo tài sản của bản thân, xem credential nếu được phép.",
  ], 42, 224, 520, 46, { size: 19 });
  addBox(slide, 650, 178, 520, 318, { fill: C.panel, line: C.panel });
  miniLabel(slide, "Điểm riêng của TTS", 684, 214, 160, C.accentLight);
  addText(slide, "Khi có phiếu đánh giá hiệu suất, TTS được xem kết quả, xác nhận hoặc yêu cầu xem xét lại trước khi chuyển lên phê duyệt.", 684, 264, 430, 126, { size: 25, bold: true });
  addText(slide, "Không có quyền xem dữ liệu toàn công ty, chỉnh user, cấu hình hệ thống hoặc truy cập database admin.", 684, 420, 420, 48, { size: 16, color: C.muted });
  addRule(slide, 42, 596, 760, C.accent);
  addText(slide, "Ý nghĩa vận hành: nhóm này cần UI đơn giản, tập trung vào tự phục vụ và minh bạch dữ liệu cá nhân.", 42, 616, 900, 28, { size: 18, color: C.muted });
}

// Slide 5
{
  const slide = presentation.slides.add();
  addHeader(slide, "HR OPERATIONS", "Nhân sự là lớp vận hành nghiệp vụ, không phải chủ hệ thống", 5);
  const left = [
    ["Nhóm chức năng", "Nhân sự có thể làm"],
    ["Chấm công", "Xem tổng hợp, lọc theo phòng ban, sửa bản ghi"],
    ["Nghỉ phép", "Xem đơn toàn công ty, duyệt / từ chối đơn"],
    ["Lương", "Tạo phiếu, xử lý review, xuất / khóa theo workflow"],
    ["Nhân sự", "Xem danh sách user, vòng đời nhân sự nếu thuộc HCNS/BGD"],
    ["Phòng ban", "Tạo, sửa, xóa phòng ban"],
    ["Tuyển dụng / MKT", "Quản lý ứng viên và chiến dịch"],
  ];
  table(slide, left, 42, 170, [250, 530], 55, { size: 14, headerSize: 14 });
  addBox(slide, 878, 190, 310, 340, { fill: C.panel, line: C.panel });
  addText(slide, "Ranh giới quan trọng", 910, 226, 240, 34, { size: 25, bold: true });
  [
    "Không có Database Admin.",
    "Không cấu hình WiFi / company settings.",
    "Không reset mật khẩu hoặc xóa user nếu UI đang giới hạn cho admin.",
    "Một số workflow hiệu suất yêu cầu department HCNS.",
  ].forEach((item, i) => {
    const yy = 292 + i * 56;
    addText(slide, "•", 910, yy, 18, 24, { size: 16, color: C.green, bold: true });
    addText(slide, item, 936, yy, 210, 46, { size: 15.5, color: C.ink });
  });
}

// Slide 6
{
  const slide = presentation.slides.add();
  addHeader(slide, "ADMIN VS HR", "Admin giống Nhân sự ở nghiệp vụ, khác ở quyền sở hữu hệ thống", 6);
  addText(slide, "Giống nhau", 42, 176, 240, 30, { size: 28, bold: true });
  bulletList(slide, [
    "Cùng thấy các khu vực quản lý công ty trong sidebar.",
    "Cùng xử lý nghiệp vụ vận hành như chấm công, nghỉ phép, lương, phòng ban.",
    "Cùng có thể xem dữ liệu tổng hợp thay vì chỉ dữ liệu cá nhân.",
  ], 42, 232, 480, 50, { size: 19, dotColor: C.green });
  addText(slide, "Khác nhau", 660, 176, 240, 30, { size: 28, bold: true });
  bulletList(slide, [
    "Admin có DB Admin, Settings và WiFi Whitelist.",
    "Admin có quyền sửa / khóa / reset / xóa tài khoản.",
    "Admin được coi như HCNS và Ban Giám Đốc trong nhiều guard.",
    "Admin thấy toàn bộ task; Nhân sự thường bị ràng bởi vai trò / phòng ban / liên quan.",
  ], 660, 232, 510, 50, { size: 19, dotColor: C.red });
  addBox(slide, 42, 548, 1096, 94, { fill: C.ink, line: C.ink });
  addText(slide, "Kết luận: Nhân sự vận hành quy trình HR hằng ngày; Admin là lớp chủ hệ thống, dùng khi cần cấu hình, can thiệp dữ liệu hoặc xử lý quyền cao nhất.", 70, 572, 1038, 50, { size: 19, bold: true, color: C.white });
}

await fs.mkdir(OUT_DIR, { recursive: true });
await fs.mkdir(`${TMP_DIR}/preview`, { recursive: true });

for (const [index, slide] of presentation.slides.items.entries()) {
  const stem = `slide-${String(index + 1).padStart(2, "0")}`;
  const png = await presentation.export({ slide, format: "png", scale: 1 });
  await fs.writeFile(`${TMP_DIR}/preview/${stem}.png`, new Uint8Array(await png.arrayBuffer()));
  const layout = await slide.export({ format: "layout" });
  await fs.writeFile(`${TMP_DIR}/preview/${stem}.layout.json`, await layout.text());
}

const montage = await presentation.export({ format: "webp", montage: true, scale: 1 });
await fs.writeFile(`${TMP_DIR}/preview/montage.webp`, new Uint8Array(await montage.arrayBuffer()));

const inspect = await presentation.inspect({ kind: "slide,textbox,shape,table,chart", maxChars: 8000 });
await fs.writeFile(`${TMP_DIR}/inspect.ndjson`, inspect.ndjson);

const pptx = await PresentationFile.exportPptx(presentation);
await pptx.save(FINAL);
console.log(FINAL);
