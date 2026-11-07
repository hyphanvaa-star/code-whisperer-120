# Vẽ sẵn toàn bộ vùng không phận Úc (DAH trang 7–188)

## Hiện trạng
- Kho vùng Úc hiện có 749 vùng (~220 KB), chỉ gồm vùng R/D/P và CTA có chữ "CTA".
- Các phân khu dạng `YBBB/DOWNS A`, `YBBB/BUNYA`, `YMMM/ESPERANCE`... bị bỏ sót nên NOTAM nhắc tên không vẽ được.
- Đã nhận file DAH_09JUL2026.pdf.

## Sức chứa (đã đếm thực tế trang 7–188)
- 1.324 vùng có LATERAL LIMITS (so với 749 hiện có → thiếu ~575 vùng, gồm CONTROL ZONE, phân khu YBBB/YMMM…).
- Dung lượng dự kiến ~0,5–0,8 MB dữ liệu toạ độ — chứa thoải mái, không cần bảng mới; vẫn lưu dạng kho dữ liệu cố định đi kèm hệ thống như các nước khác, NOTAM trúng tên chỉ việc tra ra vẽ ngay, không tốn thời gian tính lại.
- Sau khi bóc xong em sẽ báo con số chính xác (tổng vùng, theo loại, số vùng không đọc được).

## Các bước
1. Đọc toàn bộ trang 7–188, nhận mọi tiêu đề vùng: R/D/P/M, CTA/CTR, phân khu `FIR/TÊN`, vùng TRA/TIBA, MOA…
2. Chuyển LATERAL LIMITS (đường thẳng, cung tròn, vòng tròn, "then along the FIR boundary") thành đa giác; giữ trần/sàn (VERTICAL LIMITS).
3. Kiểm tra từng vùng: đa giác khép kín, nằm đúng lãnh thổ Úc; vùng lỗi ghi danh sách riêng để soát tay, không đoán ranh giới.
4. Gộp vào kho Úc hiện tại (thay bản 749 vùng), giữ khoá tên cũ để không hỏng NOTAM đã khớp.
5. Thêm thẻ "Úc - Australia" vào tab Database → Named Airspace (xem/copy toạ độ).
6. NOTAM tracking: khi E-field nhắc tên phân khu (DOWNS A, BUNYA, STRADDY, NOOSA…) trong FIR YBBB/YMMM thì gọi đa giác ra vẽ và xét giao với đường bay + mức bay (có buffer trần/sàn).
7. Viết kiểm thử: C2490/26 với VJC84 YBBN–VVTS phải tìm thấy vùng và không còn rơi vào BRIEFING INFO; vài vùng mẫu so toạ độ với PDF.
8. Tăng phiên bản (V 5.64).

## Chi tiết kỹ thuật
- Mở rộng bộ bóc tiêu đề trong `port/aip_sup.ts` (thêm mẫu `^[A-Z]{4}/[A-Z ]+`), chạy script một lần tạo `au_dah.json` mới; dữ liệu tĩnh nên không thêm bảng.
- `aip_enr_catalog.ts` + `database-tab.js` đọc thêm nguồn Úc.
- Khớp tên NOTAM chuẩn hoá (bỏ khoảng trắng, A/B hậu tố) và chỉ trong đúng FIR.
