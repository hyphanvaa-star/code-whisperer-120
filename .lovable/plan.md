# Viết lại mục 6.9 "Cơ chế bộ lọc NOTAM" (hướng dẫn v1.5)

Chỉ sửa tài liệu, không đổi web. Viết lại toàn bộ mục 6.9 cho chi tiết và cụ thể, theo đúng quy tắc đang chạy trong bộ lọc. Chỉ dùng **4 mức: CRITICAL, MANUAL CHECK, BRIEFING INFO, MINOR**.

## Bố cục mới của 6.9

### 6.9.1 Bốn mức kết quả (bảng màu)
| Mức | Ý nghĩa | Dispatcher cần làm |
|---|---|---|
| CRITICAL | Ảnh hưởng thật đến chuyến, đúng giờ kế hoạch hoặc nếu trễ trong 60 phút | Xử lý ngay: đổi route/FL, thêm fuel, sân dự bị… |
| MANUAL CHECK | Tool không đủ dữ liệu để kết luận | Mở NOTAM đọc tay |
| BRIEFING INFO | Có liên quan nhưng không cản trở khai thác | Đưa vào briefing cho tổ bay |
| MINOR | Không giao giờ/vùng/độ cao của chuyến, hoặc chỉ ảnh hưởng khi trễ quá 60 phút | Không cần xử lý (ẩn mặc định) |

### 6.9.2 Các bước lọc theo thứ tự (kèm ví dụ cho mỗi bước)
1. **Đọc NOTAM:** thiếu/không đọc được mục B, C hoặc E → MANUAL CHECK.
2. **Cửa sổ giờ theo vai trò sân/FIR:** DEP, ARR, sân dự bị, FIR. Mỗi loại có giờ trước/sau mặc định (DEP/ARR/FIR ±60′, TALT −15′/+60′) cộng trễ tối đa 180′. B–C ngoài cửa sổ → MINOR. Thiếu giờ → MANUAL CHECK.
3. **Lịch trường D:** quét từng phút trong cửa sổ. Lịch không bật → MINOR. Lịch có phần không hiểu → MANUAL CHECK.
4. **Không gian:** hành lang 15 NM quanh tuyến bay; vùng theo tọa độ, vùng có tên tra AIP (ENR 5.1/SUP); đường ATS so với FPL (quét đủ mọi route/điểm nêu trong NOTAM); navaid phải có trên FPL/navlog. Không có điểm tuyến hoặc không đo được → MANUAL CHECK.
5. **Độ cao:** dải FL của NOTAM nới thêm ±10.000 ft. FL kế hoạch ngoài dải → MINOR (riêng đoạn đường ATS → BRIEFING INFO). FIR giữa đường, NOTAM trần dưới FL100 → MINOR. Thiếu cao độ → MANUAL CHECK.
6. **Thời điểm tàu đi qua:** hiệu lực đúng giờ kế hoạch → CRITICAL. Chỉ khi trễ ≤ 60′ → CRITICAL (ghi rõ "nếu trễ X phút"). Trễ > 60′ → MINOR.

### 6.9.3 Quy tắc riêng theo loại NOTAM (bảng ví dụ)
- **MANUAL CHECK:** ILS/GNSS xuống cấp tại sân của chuyến; TORA/TODA/ASDA/LDA giảm; ETOPS/EDTO; sân hết nhiên liệu; curfew/giờ hoạt động; yêu cầu năng lực tàu (PBN, RNP, CPDLC, ADS-B, Code E…); RFFS chưa có hạng cho loại tàu; vùng không xác định ranh giới (nhãn nhấp nháy).
- **CRITICAL:** RFFS thấp hơn hạng tàu cần; đóng toàn bộ taxiway/apron; vùng cấm/hạn chế trong hành lang đúng giờ và FL; VIP MOV tại sân đến trùng ETA ±30′ → cần thêm EXTRA FUEL holding.
- **BRIEFING INFO:** RFFS còn đủ hạng; đổi tần số; đèn PAPI/ALS hỏng một phần; NDB/marker hỏng; dịch vụ sân giảm; thi công không đóng RWY; chim, wildlife; đèn hiệu sân; tu chỉnh sơ đồ; chướng ngại/cẩu không đổi minima; UA/drone trong hành lang không có chữ cấm; Jeppesen chart notice; ADS-B/GNSS/tần số FIR trên tuyến; radio check.
- **MINOR:** phí, điện thoại, NIL AIRAC; stand/taxiway một phần ở sân đi hoặc sân dự bị; navaid không có trên tuyến; advisory route không bay; ATS route không có trên FPL.

### 6.9.4 Nguyên tắc an toàn
- Không NOTAM nào bị xoá: MINOR chỉ ẩn, bấm vẫn xem được kèm lý do.
- NOTAM vừa có câu phụ (tần số, đèn…) vừa có nội dung đóng/cấm thì xét lại toàn văn, lấy mức nặng nhất.
- NOTAM sân bay mặt đất được xếp theo thứ nó đóng, không bị coi là vùng chưa xác định.
- Mỗi NOTAM có dòng **lý do**, ví dụ "Route cách vùng 8.2 NM ≤ 15 NM (gần MEXAD)", "FL350 nằm trong dải FL000–FL460".
- Các thông số (hành lang, buffer độ cao, giờ trước/sau, buffer trễ) chỉnh được ở 6.2 Cài đặt bộ lọc.

### 6.9.5 Briefing và ghim chuyến
Giữ như hiện tại.

## Kỹ thuật
- Tạo lại v1.5 từ file v1.4 bằng script hiện có. Thay khối 6.9 bằng các tiêu đề con, 2 bảng (DXA, có màu theo mức) và các đoạn văn; giữ nguyên chỉnh sửa ở mục 07, 5.3 và 11.6.
- Xuất PDF và xem các trang của 6.9 trước khi giao; lưu thành file `..._v1.6.docx`.
