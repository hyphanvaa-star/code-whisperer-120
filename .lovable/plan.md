## Kết quả so sánh NOTAM chuyến VJ5288 (VVCR–ZSHC)

Briefing pack có **167 NOTAM**, còn web tự lấy được **65 NOTAM**. Briefing pack chưa nằm trọn trong dữ liệu web.

**Các điểm có ở cả hai bên: web lấy đủ, còn có thêm NOTAM mới**
- VVCR 1/1, VVDN 9/9, VVHM 3/3, ZSNB 3/3: hai bên khớp nhau.
- ZSHC 3 → web 5 (thêm M3284/26, M3285/26). ZSNJ 5 → 6 (thêm M3277/26).
- VHHH 9 → 14, VHHK 3 → 4, ZGZU 6 → 7, ZJSA 2 → 3, ZSHA 9 → 10.
- Những NOTAM web có thêm đa số mới ra sau giờ in Briefing pack (06:44Z). Riêng A1833/19 ở ZSHA là NOTAM cũ, web có còn pack không có.

**Web thiếu 102 NOTAM, nằm ở 6 sân dự bị dọc đường bay và 1 FIR**
- RCTP 56, ZSFZ 13, RCBS 10, ZSAM 7, ZGOW 6, ZSQZ 6.
- FIR RCAA (Đài Bắc) 16.

Lý do: web hiện chỉ lấy sân đi, sân đến, sân dự bị đến và các FIR mà đường bay đi qua. Web chưa lấy các sân dự bị dọc đường bay (ERA/EDTO) ghi trên OFP và FIR chứa các sân đó.

## Đề xuất sửa
1. Đọc thêm danh sách sân dự bị dọc đường bay từ OFP của chuyến, rồi lấy NOTAM các sân này như sân dự bị.
2. Lấy thêm NOTAM của FIR chứa các sân dự bị đó (ví dụ RCAA cho RCTP/RCBS). FIR này chỉ là FIR phụ: chỉ xét NOTAM ảnh hưởng tới sân dự bị, không xếp CRUCIAL theo đường bay.
3. Các sân này hiện thành nhóm riêng "ERA" trong danh sách sân/FIR, nên tổng NOTAM sẽ gần bằng Briefing pack.
4. Nâng nhãn phiên bản lên V 5.00.

## Kỹ thuật
- Trong `notam_track.server.ts` / `fetchPlacesFor`: lấy thêm danh sách ERA từ OFP. Dùng parser alternates đã có (`ofp_alt_routes` / phần Enroute Airfields), rồi ghép thành `places` loại `A` với vai trò ERA.
- Tra FIR của từng ERA bằng dữ liệu ICAO–FIR có sẵn. Thêm FIR đó với cờ "aux" để phần phân loại chỉ dùng cho sân, không dùng cho hình học đường bay.
- Kiểm tra lại bằng cách gọi `/api/notam/track?fid=22471360` rồi so với 167 mã NOTAM trong pack.
