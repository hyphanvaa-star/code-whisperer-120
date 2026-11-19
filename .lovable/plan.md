# Góp ý bản "Hướng dẫn sử dụng Vietjet DSP Board v1.1"

## Đánh giá chung
Bố cục đã tốt: chia Phần I (đăng nhập), Phần II (giao diện từng tab), Phần III (thao tác). Bảng cột Flight Supervisor, Dispatch Tools, Notice Rules và Database rõ ràng, đúng với web hiện tại. Có thể dùng luôn, nhưng nên bổ sung các mục sau.

## Nên bổ sung (quan trọng)
1. **Cài đặt Trợ lý PC (AGENT)** — hiện chưa có hướng dẫn cài. Nhiều chức năng cần nó (In GD, Tạo EZFW, Xuất FPL.req ra ổ D, Tách MEL, gửi ATC, nháp Outlook). Thêm:
   - Thư mục dùng chung `trolypc` trên ổ Z; mọi máy dùng chung được, lệnh không lẫn giữa các người.
   - Gỡ chặn Smart App Control: chuột phải file > Properties > tick Unblock.
   - Tạo Task Scheduler tự chạy khi đăng nhập: Program `cmd.exe`, Arguments `/c start "" pythonw "...\trolypc\app\pc_agent.py"`, Start in là thư mục `trolypc`, Trigger At log on + trễ 30 giây, Settings tự chạy lại 1 phút × 3 lần.
   - Kiểm tra: chấm AGENT xanh; chạy thử `python app\pc_agent.py` trong CMD nếu không lên.
   - Từ bản 6.10 Trợ lý tự cập nhật, không cần cài lại.
2. **Điện văn trên Flight Supervisor** — mới liệt kê tên loại điện. Thêm các bước soạn/gửi CHG A/C, DLA, CHG DLA, CHG ALT, CHG ROUTE, CNL; nút Check ATC avi (chỉ chạy khi bấm) và nút File ATC Aviweb ở hàng FliteBrief.
3. **Nút "Tất cả (n)"** — nói rõ bấm sẽ chạy hàng loạt sau một lần xác nhận (không chỉ lọc).
4. **NOTAM Tracking** — thêm: 5 mức đánh giá và ý nghĩa nhãn nháy "chưa xác định vùng"; ô buffer trễ chuyến (mặc định 60 phút); cảnh báo VIP MOV cần extra holding; công cụ "Dán toạ độ vùng" (1 điểm = ghim, 2 điểm = đoạn, nhiều điểm = vùng).
5. **Tài khoản cá nhân** — đổi mật khẩu (yêu cầu có chữ, số, ký tự đặc biệt), đổi ảnh đại diện, đăng xuất; lưu ý đóng hẳn trình duyệt thì phải đăng nhập lại.

## Nên bổ sung (phụ)
6. **Xử lý sự cố thường gặp**: AGENT xám, Outlook Web đỏ, không thấy EST Omni, FliteBrief không đăng nhập, chat không hiện tin.
7. **Bảng màu/ký hiệu tổng hợp** một trang: viền đỏ, xanh lá, vàng, nhãn nháy, Good/Margin/Violation.
8. Ghi **số phiên bản web** áp dụng (V 6.95) ở trang bìa để biết tài liệu theo bản nào.
9. Một số mục còn "[Ảnh chụp màn hình]" trống cần chèn ảnh; mục 6.1 nên giải thích nhãn NOTAM thiếu/mới bấm mở danh sách.

## Cách làm khi duyệt
Mình sẽ sửa trực tiếp file Word (giữ nguyên định dạng, mục lục), chèn các mục trên vào đúng phần, xuất bản v1.2 để bạn tải về. Ảnh chụp màn hình để chỗ trống đánh dấu cho bạn tự chèn.
