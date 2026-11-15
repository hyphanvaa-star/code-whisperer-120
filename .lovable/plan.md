# NOTAM Tracking toàn màn hình: hiện cả danh sách NOTAM + bản đồ

## Lỗi hiện tại
Ở V 6.40, chế độ toàn màn hình ẩn nhầm cả cột trái chứa danh sách NOTAM (danh sách NOTAM, Thông tin chung, kết luận nằm chung khối với thanh chức năng). Vì vậy chỉ còn bản đồ, lại bị co nằm giữa màn hình.

## Sửa
- Chỉ ẩn banner ảnh máy bay và thanh chọn tab chức năng; giữ nguyên toàn bộ khu NOTAM Tracking (danh sách NOTAM, các tab chuyến, Thông tin chung, kết luận).
- Khu NOTAM bên trái và bản đồ bên phải chiếm hết chiều rộng và chiều cao màn hình (tỉ lệ giữ như hiện tại, khoảng 6:4), bỏ khoảng trống hai bên.
- Bản đồ tự vẽ lại theo kích thước mới.
- Nút Thoát toàn màn hình / Esc / tự trở lại khi đổi tab vẫn như cũ.
- Tăng phiên bản lên V 6.41.

## Chi tiết kỹ thuật
Trong shim `/tool-page` (`src/routes/tool-page.ts`): bỏ `.app>.body>aside{display:none}`; thay bằng ẩn `aside>.aside-head` (thanh tab) và sidebar CHỨC NĂNG nếu là phần tử riêng; `.app>.body` giữ grid `6fr 4fr`, height 100vh, bỏ max-width/margin của `main`. Kiểm tra bằng Playwright đăng nhập, bấm tab NOTAM, chụp màn hình xác nhận thấy cả danh sách và bản đồ.
