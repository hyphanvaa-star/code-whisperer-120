# So sánh NOTAM web với Briefing pack + báo NOTAM mới trước giờ bay 1 giờ

## Người dùng sẽ thấy gì
Thêm một cột mới bên phải nhãn "Briefing pack" trong danh sách chọn chuyến ở tab Check NOTAM:
- **Chưa có pack:** để trống (xám).
- **Có pack, web đủ hết:** "✓ Đủ NOTAM" màu xanh lá.
- **Có pack, web còn thiếu:** "✕ Thiếu N" màu đỏ. Rê chuột vào sẽ hiện các mã NOTAM bị thiếu và nơi có NOTAM đó.
- Chỉ so ở những sân bay/FIR mà cả web và pack đều có. Các sân/FIR chỉ có trong pack (sân dự bị dọc đường bay, FIR RCAA...) thì bỏ qua.

Báo NOTAM mới trước giờ bay 1 giờ:
- Web nhớ số NOTAM và danh sách mã NOTAM lúc check của từng chuyến (ví dụ 55).
- Đến mốc 1 giờ trước giờ bay (ETD, không có thì STD), web tự quét lại chuyến đó một lần.
- Có NOTAM mới (ví dụ 55 → 57): hiện thông báo đỏ "VJxxx có 2 NOTAM mới" kèm mã NOTAM, có tiếng báo. Trong danh sách chuyến hiện nhãn đỏ nhấp nháy "+2 mới" cho tới khi bạn bấm xem.
- Không có NOTAM mới (hoặc chỉ có NOTAM hết hạn bị bớt đi) thì không báo gì.
- Chỉ quét các chuyến đang trong khung −6/+24 giờ và đã từng được check ít nhất một lần.

## Phần kỹ thuật
1. **Tải pack (việc đầu tiên phải làm):** hiện web chưa tải PDF quick_pack từ FliteBrief. Cần tìm đường tải file quick_pack theo sector trong `flitebrief.server.ts` (dựa trên danh sách file đính kèm của sector đã verify). Nếu FliteBrief không cho tải tự động thì dùng phương án dự phòng: cho bạn kéo thả file pack vào chuyến.
2. Thêm một chức năng server mới (có `assertDispatcher`): tải PDF → đọc chữ → lấy mã NOTAM theo từng sân/FIR (`port/briefing_pack.ts`, có test dựa trên pack VJ5288: 167 mã, 18 nơi). Lưu kết quả vào bộ nhớ theo sector để không phải đọc lại.
3. So sánh với kết quả `/api/notam/track` của chuyến: chỉ giữ các nơi giao nhau và liệt kê mã có trong pack mà web không có. Có test: VJ5288 phải ra "Đủ".
4. Theo dõi trước giờ bay: lưu bản ghi nhỏ trên trình duyệt theo user + sector (mã NOTAM lúc check, giờ bay). Bộ hẹn giờ mỗi phút kiểm tra chuyến nào tới mốc T−60 phút thì gọi lại track một lần. "Mới" là mã chưa có trong bản lưu trước đó. Việc này chạy ngầm, không tự chuyển tab.
5. Giới hạn: chỉ quét khi web đang mở (nếu tắt hết web thì không có thông báo). Bump lên V 5.00.
