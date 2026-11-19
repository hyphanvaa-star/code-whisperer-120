# Trợ lý PC: không phải cài lại, tự phục hồi, tự cập nhật

## Thực tế máy công ty
- Ổ C: bị đóng băng, khởi động lại là mất mọi thứ mới thêm (kể cả lối tắt tự chạy).
- Ổ D: ổ chung, hay bị người khác xoá.
- Ổ Z: OneDrive, còn giữ lâu nhưng đồng bộ có thể khoá file khi đang chạy.

## Ý tưởng chính: code gốc nằm trên máy chủ web, máy chỉ giữ một "nút bật" nhỏ
1. **Nút bật nhỏ để trên Z (OneDrive)**: chỉ 1 file `Bat-Tro-Ly.vbs` vài KB, gần như không bao giờ thay đổi, nên OneDrive không gây xung đột. Bộ cài tự đặt nó vào thư mục Desktop của OneDrive (nếu có) để hiện trên màn hình mà không mất khi khởi động lại; nếu không có thì để ở gốc ổ Z. Mỗi ca bấm 1 lần.
2. **Bấm nút là tự lo hết**: nút bật kiểm tra thư mục chạy (ưu tiên `D:\.TroLyPC` ẩn, nếu không ghi được thì vào thư mục tạm của Windows). Thiếu file, file hỏng hay bản cũ thì tự tải bản mới nhất từ web về rồi chạy ngầm. Người khác xoá D hay máy khởi động lại cũng không sao, bấm lại là xong trong vài giây.
3. **Tự cập nhật khi đang chạy**: có bản mới thì Trợ lý tự tải, thay và khởi động lại, chỉ khi không có lệnh in/lưu EZFW/gửi ATC đang chạy. Lỗi thì giữ bản cũ.
4. **Không mất cài đặt**: tài khoản AviWeb/Outlook… đã lưu trên web, không lưu trên máy nên không mất khi ổ bị xoá.
5. **Trên web**: chấm AGENT hiện phiên bản; nếu chưa chạy thì hiện nút "Tải nút bật" một lần duy nhất.

## Đã xác nhận
- Python cài sẵn, không bị đóng băng: dùng Python của máy.
- Ghim taskbar trên ổ C sẽ mất, nên chỉ dùng Desktop OneDrive/ổ Z.

## Kỹ thuật
- Route mới tải gói code (zip + SHA-256 + version), xác thực bằng `PC_AGENT_TOKEN`; `/poll` trả `latest_version`.
- `Bat-Tro-Ly.vbs`: chọn thư mục ghi được (D ẩn → %TEMP%), so version/hash, tải bằng PowerShell, giải nén, chạy `background.py` qua pythonw; dùng mutex hiện có để không chạy trùng.
- `background.py`: kiểm tra version định kỳ, đổi thư mục `app`/`app.old` atomically, rollback nếu bản mới không poll được.
- Test: so version, hash sai bị từ chối, rollback, không cập nhật khi có job đang chạy.
- Máy đang chạy 6.9 cần tải nút bật một lần cuối.
