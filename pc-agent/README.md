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
set PC_AGENT_URL=https://code-whisperer-834.lovable.app
set PC_AGENT_TOKEN=<token do quản trị cấp>
python pc_agent.py
```

Để chạy mỗi khi mở máy, tạo file `tro-ly-pc.bat` với 3 dòng trên rồi đặt vào
thư mục Startup (Win+R → `shell:startup`).

Token lấy từ quản trị viên (được tạo sẵn trong kho bảo mật của web). Khi trợ
lý đang chạy, trang web sẽ nhận diện máy in và báo "đã kết nối"; tắt trợ lý
thì các nút in GD / chọn thư mục sẽ báo "trợ lý PC chưa kết nối".
