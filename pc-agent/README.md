# Trợ lý PC — Dispatch Board

Script nhỏ chạy trên máy công ty để web làm được các việc cần thiết bị nội bộ:

- **In GD** từ thư mục Outlook `GENDEC` ra máy in RICOH (đối chiếu tàu với crewlist trước khi in, giống tool gốc).
- **Ghi file xuống ổ D:** (ví dụ Omni `cargo-report …xlsx` vào `D:\Omni`).
- **Mở hộp thoại chọn thư mục** khi bạn bấm "Chọn…" trong phần đường dẫn.

## Chạy ngầm — bản 6.2

1. Giải nén toàn bộ gói vào một thư mục riêng; không chạy trực tiếp trong ZIP.
2. Lần đầu, bấm **cai-tro-ly.bat** để cài Python và thư viện. Cửa sổ cài đặt sẽ đóng khi xong.
3. Bộ cài tự tạo lối tắt khởi động cùng Windows. Trợ lý chạy ngầm và nhận tài khoản đang đăng nhập Sohee trên máy; không hỏi ID hoặc thư mục tool. Có thể bấm **Chay-Ngam.vbs** để bật lại sau khi tắt.
4. Bấm **Tat-Tro-Ly.vbs** để tắt không mở CMD (hoặc Tat-Tro-Ly.bat).

Bấm chạy nhiều lần vẫn chỉ có một trợ lý chạy ngầm trong phiên Windows; không tắt các chương trình Python khác. Nhật ký nằm ở **tro-ly.log**, tự giới hạn dung lượng. Kiểm tra kết nối bằng đèn AGENT trên web. Tắt trợ lý có thể ngắt việc đang in/tải; đợi công việc hoàn tất trước khi tắt.

Bấm **Cho phép** nếu trình duyệt hỏi quyền kết nối thiết bị trên máy. Không di chuyển/xóa thư mục đã cài vì lối tắt khởi động dùng đường dẫn này. Nếu công ty chặn VBS/Python, cần IT cho phép; không bảo đảm mọi máy đều cho chạy.

## Chạy có cửa sổ (dành cho kiểm tra lỗi)

Cần Python 3.10+ trên máy công ty:

```bat
pip install requests pywin32 openpyxl
```

## Chạy

```bat
set PC_AGENT_URL=https://soheedispatch.cloud
set PC_AGENT_TOKEN=<token do quản trị cấp>
python pc_agent.py
```

Token lấy từ quản trị viên (được tạo sẵn trong kho bảo mật của web). Khi trợ
lý đang chạy, trang web sẽ nhận diện máy in và báo "đã kết nối"; tắt trợ lý
thì các nút in GD / chọn thư mục sẽ báo "trợ lý PC chưa kết nối".

## Check FPL trên AviWeb (Selenium)

Lệnh `aviweb_check` chạy đúng code `atc_check.py` của tool gốc bằng Chrome thật trên máy này:

1. Cài thêm: `python -m pip install selenium` (Chrome đã có sẵn trên máy).
2. Công cụ có sẵn trong `app/tool`; bộ cài chuyển `.py` thành `.pyc`, trợ lý nhận được cả hai dạng. Không cần thư mục tool gốc bên ngoài.
3. Nếu công cụ bị thiếu, lỗi được ghi vào nhật ký/kết quả công việc; không mở hộp chọn thư mục. Tải lại và giải nén toàn bộ bộ cài để khôi phục.

Trên web: tab ATC → Check ATC → web gửi danh sách chuyến cho trợ lý, log hiện dần như tool gốc, kết quả (trạng thái, giờ bay, tàu, DOF) đổ về bảng.

## Outlook Web (OWA) qua Selenium
Các nút Đăng nhập OWA, Tải PIB, theo dõi FPL trên web giao việc cho trợ lý; trợ lý dùng công cụ trong `app/tool` kể cả sau khi chuyển thành `.pyc`.
Cần Chrome trên máy; bộ cài chuẩn bị Selenium. Không cần chọn thư mục tool ngoài.
