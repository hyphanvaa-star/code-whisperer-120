# Hướng dẫn sử dụng v1.5 — bổ sung thay đổi mới

Làm từ file v1.4 bạn gửi, giữ nguyên bố cục/phong cách hiện đại, xuất `Huong_dan_su_dung_Vietjet_DSP_Board_v1.5.docx`.

## 1. Sửa mục 5.3 (Tải và upload PIB/WX)
- Bỏ bước "Bấm nút đăng nhập Outlook Web và chờ 5 giây".
- Thay bằng: mở web khoảng 30 giây là tự đăng nhập Outlook Web; khi trạng thái mất OK thì tự đăng nhập lại (thử lại sau 2 / 5 / 15 phút nếu lỗi). Cần Trợ lý PC chấm xanh. MFA thì xác nhận tay. Nhiều tab chỉ một tab đăng nhập.
- Nút Outlook Web vẫn bấm tay được khi cần gấp.

## 2. Mục mới: Tự tải Defect Summary
- Ngay khi Outlook Web OK, web tự tải Defect Summary, nạp bảng giới hạn tàu và kiểm tra lại chuyến.
- Tải êm (dòng xanh), 30 phút/lần, lỗi thì 10 phút sau thử lại; đang sửa tay bảng chưa lưu thì không tự tải.
- Giữ LOW EGT và dòng nhập tay. Nút "Tải defect summary" vẫn tải ngay khi bấm.

## 3. Mục mới trong Phần II-6: Cơ chế bộ lọc NOTAM
- 5 mức đánh giá (CRITICAL → NO IMPACT); chỉ NO IMPACT bị ẩn, CRITICAL/NOTAM nhập tay không bao giờ bị ẩn.
- Lọc thời gian: NOTAM chỉ tính khi hiệu lực B–C và lịch D trùng giờ chuyến bay qua (có bộ đệm, trễ ≤ 60 phút vẫn tính).
- Lọc độ cao: FL bay ≤ trần NOTAM + bộ đệm cấu hình.
- Lọc không gian: vùng cấm/hạn chế vẽ theo toạ độ hoặc vùng có tên tra từ AIP; đường bay ATS (W195…) so với tuyến FPL, đoạn có toạ độ được nối vào điểm trên tuyến; điểm chưa xác định vẫn highlight nếu dính airway.
- NOTAM sân bay mặt đất xếp theo thứ nó đóng; vùng không xác định được ranh giới thì nhãn nhấp nháy để kiểm tra tay.
- Quốc nội giữ quy tắc riêng; NOTAM VIP MOV báo cần extra fuel holding.
- Briefing chỉ lấy NOTAM đúng FIR/sân và khung giờ (ETD−2h đến ETA+2h).

## 4. Nhắc nhanh các thay đổi nhỏ khác (vào Phần III tương ứng)
- Ô sân bay KHB: viền đỏ ⚠ khi WX xấu, viền cam NIL, xám đứt nét khi chưa có TAF.
- Bỏ nút ⚡/✈ ở ô tàu/crew KHB; ghim NOTAM 1 chạm vào chuyến đang tracking.

## Kỹ thuật
- Sửa XML của v1.4 (unpack → edit → repack theo skill docx), không tạo lại từ đầu để giữ ảnh/định dạng; cập nhật mục lục; xuất PDF kiểm tra bố cục rồi giao file vào Files.
