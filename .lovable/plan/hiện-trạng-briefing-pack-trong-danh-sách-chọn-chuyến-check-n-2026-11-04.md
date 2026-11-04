## Hiện trạng Briefing pack trong danh sách chọn chuyến (Check NOTAM)

Mỗi dòng chuyến trong danh sách thả xuống sẽ có thêm nhãn nhỏ ở bên phải:
- Chuyến đã được verify trên FliteBrief (tức là đã có Briefing pack): hiện **☑ Briefing pack** chữ xanh lá.
- Chưa verify: hiện **☐ Briefing pack** chữ đỏ.

Nhãn chỉ để xem, không làm thay đổi việc tick chọn chuyến. Danh sách chuyến đã tự làm mới theo chu kỳ, nên khi chuyến được verify thì nhãn sẽ chuyển xanh ở lần làm mới tiếp theo.

## Kỹ thuật
- Dữ liệu chuyến từ `/api/flights` đã có `verified_by` / `verified_on`; dùng giá trị này để xác định có Briefing pack.
- Trong bản vá `src/routes/tool-page.ts` (đoạn dựng dòng `nm-flt-choice`), thêm một span `nm-flt-bp ok|no` vào cuối dòng; gắn cờ verify vào option của `#nmFlt` khi dựng danh sách chuyến.
- Thêm CSS: xanh lá `#16a34a` / đỏ, chữ đậm nhỏ, căn phải.
- Tăng nhãn phiên bản lên V 4.99.
