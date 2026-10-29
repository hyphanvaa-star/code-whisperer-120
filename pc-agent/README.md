# Trợ lý PC — Dispatch Board

Script nhỏ chạy trên máy công ty để web làm được các việc cần thiết bị nội bộ:

- **In GD** từ thư mục Outlook `GENDEC` ra máy in RICOH (đối chiếu tàu với crewlist trước khi in, giống tool gốc).
- **Ghi file xuống ổ D:** (ví dụ Omni `cargo-report …xlsx` vào `D:\Omni`).
- **Mở hộp thoại chọn thư mục** khi bạn bấm "Chọn…" trong phần đường dẫn.

## Chạy ngầm — bản 5.9

1. Giải nén toàn bộ gói vào một thư mục riêng; không chạy trực tiếp trong ZIP.
2. Lần đầu, bấm **cai-tro-ly.bat** để cài Python và thư viện. Cửa sổ cài đặt sẽ đóng khi xong.
3. Những lần sau, chỉ bấm **Chay-Ngam.vbs**: không mở CMD. Nếu chưa nhớ tài khoản, hộp nhỏ hỏi ID đăng nhập Sohee một lần để ghép đúng người.
4. Bấm **Tat-Tro-Ly.vbs** để tắt không mở CMD (hoặc Tat-Tro-Ly.bat).

Bấm chạy nhiều lần vẫn chỉ có một trợ lý chạy ngầm trong phiên Windows; không tắt các chương trình Python khác. Nhật ký nằm ở **tro-ly.log**, tự giới hạn dung lượng. Kiểm tra kết nối bằng đèn AGENT trên web. Tắt trợ lý có thể ngắt việc đang in/tải; đợi công việc hoàn tất trước khi tắt.

Muốn tự chạy khi đăng nhập Windows: tạo lối tắt của **Chay-Ngam.vbs**, rồi đặt lối tắt vào thư mục mở bằng Win+R → `shell:startup`. Không cần quyền quản trị. Nếu công ty chặn VBS/Python, cần IT cho phép; không bảo đảm mọi máy đều cho chạy.

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
2. Đặt biến môi trường `PC_TOOL_DIR` trỏ tới thư mục tool gốc (nơi có `atc_check.py`, `config.py`) — ví dụ `D:\DispatchBoard`. Nếu không đặt, trợ lý tự tìm ở `C:\DispatchBoard`, `D:\DispatchBoard`, `~/DispatchBoard`, `~/Desktop/DispatchBoard`.
3. Tài khoản AviWeb lấy từ `config.py` của tool gốc trên máy — không gửi qua web.

Trên web: tab ATC → Check ATC → web gửi danh sách chuyến cho trợ lý, log hiện dần như tool gốc, kết quả (trạng thái, giờ bay, tàu, DOF) đổ về bảng.

## Outlook Web (OWA) qua Selenium
Các nút Đăng nhập OWA, Tải PIB, theo dõi FPL trên web giao việc cho trợ lý; trợ lý chạy đúng code gốc `outlook_web_pib.py`, `owa_fpl_watch.py` (và `outlook_pib.py` dự phòng) trong thư mục `PC_TOOL_DIR`.
Cần: `pip install selenium`, Chrome trên máy, `PC_TOOL_DIR` trỏ thư mục tool gốc (tài khoản lấy từ config.py trên máy như tool cũ).
