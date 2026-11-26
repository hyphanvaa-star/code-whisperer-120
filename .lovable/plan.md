# Đưa SIGMET vào ô "En-route SIG Wx" của Briefing form (V 7.74)

## Kết quả bạn sẽ thấy

- Khi tạo Briefing cho một chuyến, ô **En-route SIG Wx** tự điền nguyên văn các SIGMET còn hiệu lực của **mọi FIR chuyến bay đi qua** (danh sách FIR lấy từ EET trong OFP, cộng FIR của sân đi/đến), kể cả vùng nằm xa đường bay.
- SIGMET được gom theo từng FIR, đúng thứ tự bay qua, ví dụ:

```text
WAAF (FliteBrief)
WAAF SIGMET 20 VALID 252220/260420 WAAA- WAAF UJUNG PANDANG FIR VA ERUPTION MT SEMERU ...
WAAF SIGMET 21 VALID 252240/260440 WAAA- ...

VVHM (FliteBrief): NIL
WSJC (NOAA)
WSJC SIGMET 3 VALID ...
```

- Nguồn: ưu tiên **FliteBrief**; FIR nào FliteBrief không đọc được thì lấy **NOAA** và ghi rõ nguồn cạnh tên FIR.
- Chỉ ghi **NIL** khi đã đọc được nguồn và thật sự không có SIGMET. FIR nào cả hai nguồn đều không đọc được sẽ ghi "chưa đọc được SIGMET" — không bao giờ tự ghi NIL thay cho dữ liệu thiếu.
- Ô vẫn sửa tay được. Nếu bạn đã sửa tay ô này cho chuyến đó thì giữ nội dung của bạn; khi đổi BF (tạo lại Briefing) thì SIGMET lấy mới như phần thời tiết khác, NOTAM/note cũ vẫn giữ như hiện nay.
- Bản PDF xuất ra có đủ SIGMET; nhiều SIGMET thì chữ tự co và tràn sang trang sau, không cắt mất nội dung.

## Các bước làm

1. **Xác minh nguồn FliteBrief (bước đầu tiên, chưa xác nhận):** đọc thử dữ liệu FIR trực tiếp từ FliteBrief (ví dụ WAAF) để xem mục SIGMET nằm ở đâu. Hiện mới biết chắc tài liệu Quick Pack của FliteBrief có mục "FIR SIGMET Information", còn dữ liệu FIR trực tiếp có SIGMET hay không thì chưa kiểm tra. Nếu dữ liệu trực tiếp không có, FliteBrief sẽ được đọc từ mục "FIR SIGMET Information" trong Quick Pack của chính chuyến đó, và NOAA dùng để bổ sung bản mới hơn.
2. Viết phần gom SIGMET theo FIR: lọc còn hiệu lực, bỏ bản trùng, sắp theo FIR, ghi nguồn, phân biệt rõ "không có" và "chưa đọc được".
3. Gắn vào lúc tạo Briefing để điền ô En-route SIG Wx (màn hình, bản chữ và PDF dùng chung một nội dung).
4. Giữ nội dung sửa tay; đổi BF thì lấy SIGMET mới.
5. Thêm kiểm thử và kiểm tra trên trình duyệt với một chuyến qua FIR đang có SIGMET, tăng nhãn phiên bản lên V 7.74.

## Chi tiết kỹ thuật

- Mới: `src/lib/tool/port/briefing_sigmet.ts` (thuần, browser-safe) — nhận danh sách FIR + SIGMET từng nguồn + thời điểm hiện tại, trả về chuỗi cho `sig_wx`. Trạng thái mỗi FIR: `items | none | unread`.
- `src/lib/tool/briefing-data.server.ts`: thêm bộ đọc SIGMET theo FIR, dùng lại `fbJson` (chỉ trong `flitebrief.server.ts`) với timeout/cache như `portalCount`; dự phòng NOAA dùng lại `sigmetItems` trong `port/sigmet.ts` (bỏ bộ lọc vùng bản đồ nếu cần, lọc theo `fir`). Lớp SIGMET trên bản đồ NOTAM không đổi.
- `src/lib/tool/port/briefingRelease.ts`: `draftFromFlight` nhận thêm `sigmetFor(firs)` và điền `sheet.sig_wx` sau `buildSheet`, trước khi áp `loadEdits` để chỉnh tay đã lưu vẫn thắng; FIR lấy từ `parseEetFirs` + `airportParentFir` như `pinContext`.
- `port/briefingPrevious.ts` không khôi phục `sig_wx` cũ (giữ nguyên quy tắc: WX lấy mới).
- `briefingPdf.ts`: dòng En-route SIG Wx đã tự xuống dòng/chia trang, chỉ kiểm tra lại với nội dung dài.
- Kiểm thử trong `port/__tests__/briefing_sigmet.test.ts`: FIR có SIGMET, FIR đọc được nhưng trống → NIL, FIR không đọc được → không NIL, FliteBrief thắng NOAA, SIGMET hết hạn bị loại, sửa tay được giữ; dùng fixture `quick_pack_vj5288.txt` cho mục "FIR SIGMET Information".
- Ghi một dòng quy tắc vào `AGENTS.md` và lưu yêu cầu vào memory.
