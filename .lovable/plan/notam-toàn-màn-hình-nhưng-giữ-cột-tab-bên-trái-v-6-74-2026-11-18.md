# NOTAM toàn màn hình nhưng giữ cột tab bên trái (V 6.74)

## Kết quả
Khi mở NOTAM tracking ở chế độ toàn màn hình:
- Ẩn header trên cùng như hiện nay.
- **Vẫn giữ cột tab bên trái** (Flight Supervisor, NOTAM, KHB…), thu gọn thành thanh dọc hẹp chỉ có biểu tượng màu riêng, tab đang chọn đỏ. Rê chuột vào hiện tên tab, bấm là chuyển tab (tự thoát toàn màn hình như khi rời NOTAM).
- Danh sách NOTAM và bản đồ chiếm phần còn lại, bố cục 2 cột giữ nguyên.
- Nút "Thoát toàn màn hình" và phím Esc giữ nguyên.

## Technical details
- Trong `src/routes/tool-page.ts` (khối CSS `body.nm-full` ~dòng 3150): bỏ `.aside-head` khỏi quy tắc ẩn; đặt `.aside-head` thành rail `position:fixed;left:0;top:0;bottom:0;width:64px` với nhãn tab ẩn chữ (icon-only, `title` hiện tên), z-index dưới `#nmFullBtn`.
- Grid `.body` thêm `padding-left:72px` để không đè lên rail; `nmMap.invalidateSize()` sau khi đổi.
- appVersion → V 6.74; ghi rule vào `src/routes/AGENTS.md`.
- Kiểm tra bằng Playwright: mở NOTAM fullscreen, chụp màn hình xác nhận có rail tab và bấm được tab khác.
