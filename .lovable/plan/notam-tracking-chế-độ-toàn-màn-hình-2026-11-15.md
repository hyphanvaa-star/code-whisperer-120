# NOTAM Tracking: chế độ toàn màn hình

## Mục tiêu
Khi bấm tab **NOTAM Tracking** ở thanh bên, khu vực NOTAM (danh sách, Thông tin chung, bản đồ) tự phóng to chiếm toàn bộ màn hình để chữ và bản đồ to, dễ đọc.

## Hành vi
- Bấm NOTAM Tracking → ẩn banner đầu trang (ảnh máy bay, ô DISPATCHER/CALLSIGN...) và thanh CHỨC NĂNG bên trái; khung NOTAM + bản đồ giãn ra full chiều rộng và chiều cao cửa sổ.
- Góc trên có nút **⤢ Thoát toàn màn hình** (và phím Esc) để hiện lại banner + thanh bên khi cần đổi chuyến hoặc sang tab khác. Bấm lại nút sẽ vào lại chế độ to.
- Chuyển sang tab khác → tự trở về bố cục bình thường.
- Bản đồ tự vẽ lại theo kích thước mới (không bị ô xám/lệch).
- Nút thu/phóng riêng của khung chữ và bản đồ hiện có vẫn giữ nguyên.
- Trạng thái "đã thoát" được nhớ trên trình duyệt để lần sau không tự bật nếu anh không muốn (tuỳ chọn, mặc định bật).

## Kỹ thuật
- Thêm qua shim `/tool-page` (không sửa trực tiếp HTML gốc): CSS lớp `body.nm-fullscreen` ẩn header/sidebar, đặt panel NOTAM `position:fixed; inset:0`, chia 2 cột theo tỉ lệ hiện tại.
- Hook vào hàm chuyển tab hiện có: vào tab NOTAM thì thêm lớp, rời tab thì gỡ; gọi `map.invalidateSize()` sau khi đổi.
- Chat widget và popup vẫn nằm trên cùng.
- Bump phiên bản V 6.40.
