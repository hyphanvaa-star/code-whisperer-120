# Chỉnh thông số Extra fuel trong Filter setting

## Anh sẽ thấy gì
- Trong **⚙ Filter setting** có thêm mục **Extra fuel (TAF sân đến)**.
- Anh sửa được:
  - Bảng hiện tượng thời tiết theo 4 dải tầm nhìn A/B/C/D, kể cả mốc mét của từng dải.
  - Số phút trừ khi TAF ghi "−", cộng khi ghi "+".
  - Các mốc trần mây và số phút tương ứng.
  - Các mốc gió trung bình/giật và số phút tương ứng.
  - Giới hạn tối đa, hiện là 60 phút.
- Có nút **Khôi phục mặc định**, đưa về đúng các con số đang dùng hôm nay.
- Admin sửa thì áp dụng cho cả team. Dispatcher khác sửa thì chỉ đổi cho riêng mình, không ảnh hưởng người khác (giống bảng CI/Taxi).
- Lưu xong, ô EXTRA và nhãn "WX XẤU CẦN EXTRA" tính lại theo số mới. Khi rê chuột vào ô, phần ghi chú nêu đúng luật đã dùng, ví dụ "wx TSRA dải C = 60p".

## Technical
- `port/extra_wx.ts`: tách các bảng WX, vis band, ceil, wind, sign và CAP thành `ExtraWxCfg` + `DEFAULT_EXTRA_WX`. `needOfText/needOfTexts(chunks, cfg?)` nhận cfg, nếu thiếu thì dùng mặc định. Thêm `normalizeExtraWxCfg` để kẹp số trong 0..CAP, các mốc phải giảm dần, khoá lạ bị bỏ.
- `port/taf.ts` `advise(..., cfg?)`: truyền cfg xuống. Handler TAF/flights đọc cfg từ store key mới `extra_wx_cfg`, thêm key này vào `LAYERED_KEYS`.
- UI: thêm panel vào Filter setting qua shim `tool-page.ts` (không sửa trực tiếp page.html). Dùng lại API lưu/đọc setting có sẵn. Sau khi lưu thì gọi refresh TAF rồi `paintExtraCells()`.
- Test `__tests__/extra_wx.test.ts`: cfg mặc định cho ra đúng số như hiện nay (TSRA dải C = 60, BKN006 = 30, gió G35 = 15). Thêm test cfg tuỳ chỉnh (đổi TSRA C = 45 thì ra 45) và test CAP tuỳ chỉnh.
- Tăng appVersion lên V 6.69, ghi rule vào `src/lib/tool/AGENTS.md`, cập nhật roadmap.
