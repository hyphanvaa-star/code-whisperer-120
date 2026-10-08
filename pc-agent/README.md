# Trợ lý PC — Dispatch Board

Script nhỏ chạy trên máy công ty để web làm được các việc cần thiết bị nội bộ:

- **In GD** từ thư mục Outlook `GENDEC` ra máy in RICOH (đối chiếu tàu với crewlist trước khi in, giống tool gốc).
- **Ghi file xuống ổ D:** (ví dụ Omni `cargo-report …xlsx` vào `D:\Omni`).
- **Mở hộp thoại chọn thư mục** khi bạn bấm "Chọn…" trong phần đường dẫn.

## Cài đặt (một lần)

Cần Python 3.10+ trên máy công ty:

```bat
pip install requests pywin32 openpyxl
```

## Chạy

```bat
set PC_AGENT_URL=https://sohee-dispatch-tool-v3.lovable.app
set PC_AGENT_TOKEN=<token do quản trị cấp>
python pc_agent.py
```

Để chạy mỗi khi mở máy, tạo file `tro-ly-pc.bat` với 3 dòng trên rồi đặt vào
thư mục Startup (Win+R → `shell:startup`).

Token lấy từ quản trị viên (được tạo sẵn trong kho bảo mật của web). Khi trợ
lý đang chạy, trang web sẽ nhận diện máy in và báo "đã kết nối"; tắt trợ lý
thì các nút in GD / chọn thư mục sẽ báo "trợ lý PC chưa kết nối".

## Check FPL trên AviWeb (Selenium)

Lệnh `aviweb_check` chạy đúng code `atc_check.py` của tool gốc bằng Chrome thật trên máy này:

1. Cài thêm: `python -m pip install selenium` (Chrome đã có sẵn trên máy).
2. Đặt biến môi trường `PC_TOOL_DIR` trỏ tới thư mục tool gốc (nơi có `atc_check.py`, `config.py`) — ví dụ `D:\DispatchBoard`. Nếu không đặt, trợ lý tự tìm ở `C:\DispatchBoard`, `D:\DispatchBoard`, `~/DispatchBoard`, `~/Desktop/DispatchBoard`.
3. Tài khoản AviWeb lấy từ `config.py` của tool gốc trên máy — không gửi qua web.

Trên web: tab ATC → Check ATC → web gửi danh sách chuyến cho trợ lý, log hiện dần như tool gốc, kết quả (trạng thái, giờ bay, tàu, DOF) đổ về bảng.

## Outlook Web (OWA) qua Selenium
Các nút Đăng nhập OWA, Tải PIB, theo dõi FPL trên web giao việc cho trợ lý; trợ lý chạy đúng code gốc `outlook_web_pib.py`, `owa_fpl_watch.py` (và `outlook_pib.py` dự phòng) trong thư mục `PC_TOOL_DIR`.
Cần: `pip install selenium`, Chrome trên máy, `PC_TOOL_DIR` trỏ thư mục tool gốc (tài khoản lấy từ config.py trên máy như tool cũ).
