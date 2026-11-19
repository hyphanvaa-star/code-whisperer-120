# Trợ lý PC: cài 1 lần, tự cập nhật

## Vấn đề hiện tại
- Mỗi lần có bản mới (6.8 → 6.9…) phải tải lại ZIP, giải nén, chạy lại `cai-tro-ly.bat`.
- Trợ lý không tự kiểm tra hay tải bản mới; không tự bật khi khởi động máy.

## Đề xuất
1. **Tự cập nhật ngầm**: mỗi lần poll, máy chủ báo số phiên bản mới nhất. Nếu Trợ lý cũ hơn, nó tự tải gói mới (chỉ phần code), kiểm tra toàn vẹn, thay file, tự khởi động lại. Không mở cửa sổ, không cần người dùng làm gì.
   - Chỉ cập nhật khi không có lệnh đang chạy (in, lưu EZFW, gửi ATC).
   - Lỗi tải/giải nén → giữ nguyên bản cũ đang chạy, thử lại sau.
2. **Tự chạy khi bật máy**: bộ cài thêm lối tắt vào Startup của Windows (không cần quyền admin). Tắt Trợ lý bằng nút Tắt như cũ.
3. **Cài đúng 1 lần**: bộ cài lần đầu cài vào thư mục cố định (`%LOCALAPPDATA%\TroLyPC`), không phụ thuộc chỗ giải nén ZIP.
4. **Trên web**: chấm AGENT hiện phiên bản đang chạy; nếu cũ hiện nhãn vàng "Đang tự cập nhật…" thay vì bắt cài lại.

## Kỹ thuật
- Server: thêm `latest_version` + đường dẫn gói + SHA-256 vào phản hồi `/api/public/pc-agent/poll`; gói code tải qua route có `PC_AGENT_TOKEN`.
- `background.py`: vòng kiểm tra version, tải vào thư mục tạm, xác minh hash, compile .pyc, đổi tên thư mục atomically (`app` ↔ `app.old`), relaunch qua mutex hiện có; rollback nếu bản mới không poll được trong 2 phút.
- `cai-tro-ly.bat`: copy vào `%LOCALAPPDATA%`, tạo shortcut Startup cho `Chay-Ngam.vbs`.
- Test: so sánh version, hash sai bị từ chối, rollback, không cập nhật khi có job running.
- Lưu ý: máy đang chạy 6.9 cần cài tay **một lần cuối** để có khả năng tự cập nhật.
