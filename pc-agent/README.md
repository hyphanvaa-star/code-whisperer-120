# Trợ lý PC — Dispatch Board

Script nhỏ chạy trên máy công ty để web làm được các việc cần thiết bị nội bộ:

- **In GD** từ thư mục Outlook `GENDEC` ra máy in RICOH (đối chiếu tàu với crewlist trước khi in, giống tool gốc).
- **Ghi file xuống ổ D:** (ví dụ Omni `cargo-report …xlsx` vào `D:\Omni`).
- **Mở hộp thoại chọn thư mục** khi bạn bấm "Chọn…" trong phần đường dẫn.

## Cài và chạy — chỉ 1 file

1. Trên web bấm chấm **AGENT** (khi xám) để tải đúng 1 file **Bat-Tro-Ly.vbs**. Chrome có hỏi thì chọn **Giữ lại**.
2. Để file ở ổ Z (thư mục riêng của bạn) hoặc màn hình. Bấm đúp: nó tự tải mã nguồn về thư mục ẩn `D:\.TroLyPC` (không ghi được thì `%LOCALAPPDATA%\SoheeTroLyPC`), tự cài thư viện còn thiếu và chạy ngầm. Chấm AGENT xanh sau vài giây.
3. Muốn tự bật khi mở máy: Task Scheduler → Action `wscript.exe`, Arguments `"<đường dẫn>\Bat-Tro-Ly.vbs"`.
4. Tắt: bấm chấm AGENT xanh trên web → OK. Thư mục ẩn bị xoá thì bấm đúp lại file là tự khôi phục.

Cần Python 3 trên máy. Bấm chạy nhiều lần vẫn chỉ có một trợ lý chạy ngầm. Nhật ký: `tro-ly.log`, `khoi-dong.log` trong thư mục ẩn.

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
2. Công cụ có sẵn trong `app/tool`; bản cài chuyển `.py` thành `.pyc`, trợ lý nhận được cả hai dạng. Không cần thư mục tool gốc bên ngoài.
3. Nếu công cụ bị thiếu, lỗi được ghi vào nhật ký/kết quả công việc; không mở hộp chọn thư mục. Bấm đúp lại Bat-Tro-Ly để tải lại.

Trên web: tab ATC → Check ATC → web gửi danh sách chuyến cho trợ lý, log hiện dần như tool gốc, kết quả (trạng thái, giờ bay, tàu, DOF) đổ về bảng.

## Outlook Web (OWA) qua Selenium
Các nút Đăng nhập OWA, Tải PIB, theo dõi FPL trên web giao việc cho trợ lý; trợ lý dùng công cụ trong `app/tool` kể cả sau khi chuyển thành `.pyc`.
Cần Chrome trên máy; Bat-Tro-Ly tự cài Selenium. Không cần chọn thư mục tool ngoài.
