# Hướng dẫn v1.8 — Viết lại mục Bộ lọc NOTAM

## Mục tiêu
Giữ cách viết dễ hiểu của bản v1.6 (anh thấy hay hơn), nhưng trình bày chuyên nghiệp hơn, và thêm rõ quy tắc FIR enroute dưới FL100 / 50 NM.

## Nội dung mục 6.9 (thay thế bản v1.7)
1. **Tổng quan 4 mức** — đoạn mở ngắn + bảng màu: CRITICAL (đỏ), MANUAL CHECK (cam), BRIEFING INFO (xanh dương), MINOR (xám). Mỗi dòng: ý nghĩa · DSP cần làm gì.
2. **Từng mức một tiểu mục** (giữ văn phong v1.6): khi nào NOTAM rơi vào mức này, ví dụ thực tế (RWY CLSD, ILS U/S, RFFS giảm cấp, VIP MOV, khu vực cấm/nguy hiểm, navaid…), hành động của DSP.
3. **Quy tắc FIR enroute dưới FL100 (mới, khung nổi bật)**:
   - NOTAM FIR có trần dưới FL100 và cách DEP/ARR ≤ 50 NM → **giữ lại xét tiếp** (máy bay đang lên/xuống).
   - Cách > 50 NM → **bỏ qua (MINOR)** vì chuyến bay đang bay bằng.
   - Không đo được khoảng cách → giữ lại để an toàn.
   - Chỉnh số 50 NM trong ⚙ Filter setting (mặc định 50, tối đa 500).
   - Kèm sơ đồ minh hoạ vòng 50 NM quanh DEP/ARR.
4. **Thứ tự hệ thống kiểm tra** — sơ đồ dạng dòng chảy ngắn: Thời gian → Lịch (Item D) → Vị trí/đường bay → Độ cao (gồm quy tắc 50 NM) → Delay.
5. **Ghim chuyến & Briefing** — giữ như v1.6, gọn lại.

## Trình bày
- Bảng có viền mảnh, tiêu đề nền màu theo mức, khung ghi chú (callout) cho quy tắc quan trọng.
- Thuật ngữ OCC chuẩn, câu ngắn, không lặp ý.
- Các phần khác của hướng dẫn giữ nguyên.

## Kết quả
- Lưu file mới `Huong_dan_su_dung_Vietjet_DSP_Board_v1.8.docx`, không ghi đè v1.7.
- Xuất từng trang ra ảnh để kiểm tra lỗi bố cục trước khi gửi.
