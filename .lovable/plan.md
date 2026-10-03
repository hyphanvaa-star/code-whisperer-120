# Dispatch Board web — giao diện mới, tool chạy thẳng trên web

## Ý tưởng chính
Viết lại tối đa tool Python (web.py ~35.000 dòng, ~140 chức năng) để chạy trực tiếp trên web, không cần bật gì trên PC. Chỉ những việc bắt buộc phải có máy trong công ty mới để lại cho một "trợ lý PC" nhỏ (làm sau cùng, tuỳ chọn):
- In GD ra máy in
- Đài khí tượng / trang chỉ vào được từ mạng nội bộ
- Tự động điều khiển Chrome

```text
Trình duyệt dispatcher ──> Web app (đăng nhập, phân quyền, nhật ký)
                               ├─ FliteBrief, NOTAM/AIP, WX công khai, KHB/FPL
                               ├─ Outlook hộp thư chung (kết nối 1 lần cho cả nhóm)
                               └─ (tuỳ chọn) trợ lý PC: in, mạng nội bộ
```

## Giao diện
- Theme sáng, hiện đại, đỏ Vietjet #c41e3a, logo VJ từ bản gốc; font IBM Plex Sans + JetBrains Mono; giờ UTC.
- Header: logo, đồng hồ UTC, pill **Ca sáng / Ca đêm**, tài khoản.
- Hàng tab giống bản gốc: Hiển thị chung · Dữ liệu so sánh · Công cụ hỗ trợ · NOTAM · Tạo KHB · Giao ca · Tàu/Defect · Notice · ATC.
- **Quản trị** tách ra trang riêng `/admin`, layout riêng, chỉ admin thấy link.

## Các tab (đều chạy thật)
1. **Hiển thị chung** — danh sách chuyến, lọc dispatcher, chi tiết FLT / OFP / MEL, tải PDF hàng loạt có tiến độ trực tiếp.
2. **Dữ liệu so sánh** — nạp Excel, chọn sheet/cột, so với FliteBrief, tô ô lệch.
3. **Công cụ hỗ trợ** — tải PIB (từ hộp thư chung Outlook) và WX theo danh sách chuyến, có tiến độ.
4. **NOTAM** — Check NOTAM, Track NOTAM theo chuyến, bản đồ vẽ vùng NOTAM.
5. **Tạo KHB / FPL text** — build, route, alt, extra, taxi, PCR, xuất text.
6. **Giao ca** — trống tới khi chọn DSP và bấm **Nạp**; tick ATC / EZFW / ATFM, ghi chú; lưu lại để ca sau xem.
7. **Tàu/Defect, Notice rules, ATC check, nháp ATC+EZFW** — chạy trên web; **In GD** tạo file PDF để in (in thẳng máy in chỉ khi có trợ lý PC).

## Outlook (PIB)
- Chính: hộp thư chung của nhóm, kết nối Microsoft một lần trong trang Quản trị; dispatcher không phải đăng nhập Microsoft riêng.
- Dự phòng: nếu hộp chung không có PIB, dùng hộp thư của tài khoản Microsoft dự phòng do quản trị viên kết nối thêm (thay cho "hộp đang login trên máy" của bản gốc).

## Thứ tự làm
1. Theme + header + hàng tab + tách trang Quản trị.
2. Tab 1 (dựng lại), 2, 6.
3. Kết nối Outlook + tab 3.
4. Tab 4, 5, 7 — đối chiếu từng nút với web.py gốc.
5. (Tuỳ chọn) trợ lý PC cho in và mạng nội bộ.

## Chi tiết kỹ thuật
- Mỗi module Python → `src/lib/<module>.server.ts` + `*.functions.ts` (assertDispatcher, logActivity); tiến độ việc dài qua server route SSE.
- Outlook qua connector Microsoft Outlook (chung + dự phòng = 2 kết nối, gọi Graph `/me/messages`).
- Bảng mới `handovers`, `excel_uploads`, `notam_pins` (RLS dispatcher, có GRANT).
- Excel phân tích bằng SheetJS trên trình duyệt.
- Cập nhật AGENTS.md: logic nghiệp vụ chạy trên web; trợ lý PC chỉ cho in/mạng nội bộ.
