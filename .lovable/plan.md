# Mở đúng chức năng trong tab trình duyệt mới

## Trải nghiệm
- Chuột phải vào một thẻ đang hiển thị ở thanh bên trái, ví dụ **NOTAM Tracking**, sẽ hiện menu nhỏ **“Mở tab mới ↗”**.
- Chọn menu đó sẽ mở một tab trình duyệt mới vào thẳng **NOTAM Tracking**; tab hiện tại giữ nguyên vị trí và dữ liệu đang xem.
- Bấm chuột trái vẫn chuyển thẻ trong trang như hiện nay. Menu chuột phải tự đóng khi bấm nơi khác hoặc nhấn Esc.
- Áp dụng cho các thẻ đang hiển thị: Flight Planning, Shift Handover, Flight Supervisor, Dispatch Tools, NOTAM Tracking, Aircraft & Airport Limits, Notice Rules, Database và Account Management. Các thẻ đang ẩn không xuất hiện trong tính năng này.

## Cách hoạt động
- Tạo địa chỉ có thể mở trực tiếp theo mẫu `/tool?tab=notam`; mỗi thẻ có một mã riêng, chỉ nhận mã hợp lệ.
- Trang mới dùng lại đúng thao tác mở thẻ hiện có để các bước khởi tạo riêng vẫn chạy, ví dụ tải danh sách giao ca hoặc dựng bản đồ NOTAM.
- Không có mã thẻ hoặc mã không hợp lệ thì vẫn mở **Flight Supervisor** như hiện tại.
- **Database** mở bằng chính nút Database hiện có. **Account Management** chỉ tự mở sau khi quyền quản lý tài khoản được xác nhận.
- Tab mới chỉ mở giao diện; không tự chạy Check NOTAM, tải file hay gửi điện. Đăng nhập và dữ liệu tài khoản vẫn theo cơ chế dùng chung hiện tại.

## Kỹ thuật
- Thêm bộ ánh xạ thẻ và menu chuột phải trong phần bổ trợ `/tool-page`, không sửa trực tiếp `src/tool/page.html`.
- Truyền mã thẻ từ `src/routes/_authenticated/tool.tsx` vào iframe và xử lý thẻ được yêu cầu sau khi các thành phần động đã khởi tạo.
- Thêm kiểm thử cho ánh xạ NOTAM, các thẻ thường, Database, Account Management và mã không hợp lệ.
- Kiểm tra trên trình duyệt: chuột phải NOTAM Tracking → mở tab mới đúng NOTAM Tracking, tab cũ không đổi; thử thêm Database và một thẻ thường.
- Nâng nhãn phiên bản lên **V 7.90**, cập nhật roadmap và để ở bản preview; không publish nếu anh chưa yêu cầu.
