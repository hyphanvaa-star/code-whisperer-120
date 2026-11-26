# Đưa SIGMET vào ô "En-route SIG Wx" của Briefing form (V 7.74)

## Kết quả bạn sẽ thấy

- Khi tạo Briefing cho một chuyến, ô **En-route SIG Wx** tự điền nguyên văn SIGMET của các FIR chuyến bay đi qua (danh sách FIR lấy từ EET trong OFP, cộng FIR của sân đi).
- **Chỉ lấy SIGMET trùng giờ chuyến ở trong FIR đó:** với mỗi FIR, tính giờ vào và giờ ra của chuyến; SIGMET nào có khung hiệu lực (VALID ddhhmm/ddhhmm) chạm vào khoảng giờ đó thì lấy, nằm ngoài thì bỏ.
  - Giờ vào FIR = ETD + thời gian EET của FIR đó trong OFP; giờ ra = giờ vào FIR kế tiếp (FIR cuối: ETA). FIR sân đi tính từ ETD.
  - Thêm biên an toàn **30 phút** trước giờ vào và sau giờ ra để phòng chuyến lệch giờ nhẹ.
  - Chuyến delay (ETD đổi) thì khung giờ từng FIR tính lại theo ETD mới khi tạo lại Briefing.
- SIGMET gom theo FIR, đúng thứ tự bay qua, **không ghi nguồn**:

```text
WAAF
WAAF SIGMET 20 VALID 252220/260420 WAAA- WAAF UJUNG PANDANG FIR VA ERUPTION MT SEMERU ...
WAAF SIGMET 21 VALID 252240/260440 WAAA- ...

WSJC
WSJC SIGMET 3 VALID ...
```

- Nguồn dữ liệu vẫn ưu tiên **FliteBrief**, FIR nào FliteBrief không đọc được thì dùng **NOAA** (chỉ là cách lấy, không in ra tờ Briefing).
- Ghi **NIL** khi mọi FIR đều đọc được và không có SIGMET nào trùng giờ bay. FIR nào cả hai nguồn đều không đọc được sẽ ghi "<FIR>: chưa đọc được SIGMET" — không tự ghi NIL thay cho dữ liệu thiếu.
- Ô vẫn sửa tay được. Nếu bạn đã sửa tay ô này cho chuyến đó thì giữ nội dung của bạn; khi đổi BF (tạo lại Briefing) thì SIGMET lấy mới như phần thời tiết khác, NOTAM/note cũ vẫn giữ như hiện nay.
- Bản PDF xuất ra có đủ SIGMET; nhiều SIGMET thì chữ tự co và tràn sang trang sau, không cắt mất nội dung.

Lưu ý vận hành: SIGMET thường chỉ hiệu lực 4–6 giờ và được phát lại liên tục, nên Briefing tạo quá sớm trước giờ bay có thể chưa có SIGMET của khung giờ bay — nên tạo/tạo lại gần giờ release.

## Các bước làm

1. **Xác minh nguồn FliteBrief (bước đầu tiên, chưa xác nhận):** đọc thử dữ liệu FIR trực tiếp từ FliteBrief (ví dụ WAAF) để xem mục SIGMET nằm ở đâu. Hiện mới biết chắc tài liệu Quick Pack của FliteBrief có mục "FIR SIGMET Information", còn dữ liệu FIR trực tiếp có SIGMET hay không thì chưa kiểm tra. Nếu dữ liệu trực tiếp không có, FliteBrief sẽ được đọc từ mục "FIR SIGMET Information" trong Quick Pack của chính chuyến đó, và NOAA dùng để bổ sung bản mới hơn.
2. Viết phần gom SIGMET theo FIR: tính khung giờ từng FIR, đọc giờ hiệu lực VALID của từng SIGMET, lọc theo khung giờ, bỏ bản trùng, sắp theo thứ tự bay qua, phân biệt rõ "không có" và "chưa đọc được".
3. Gắn vào lúc tạo Briefing để điền ô En-route SIG Wx (màn hình, bản chữ và PDF dùng chung một nội dung).
4. Giữ nội dung sửa tay; đổi BF thì lấy SIGMET mới.
5. Thêm kiểm thử và kiểm tra trên trình duyệt với một chuyến qua FIR đang có SIGMET, tăng nhãn phiên bản lên V 7.74.

## Chi tiết kỹ thuật

- Mới: `src/lib/tool/port/briefing_sigmet.ts` (thuần, browser-safe) — nhận khung giờ từng FIR + SIGMET từng FIR, trả về chuỗi cho `sig_wx`. Trạng thái mỗi FIR: `items | none | unread`. Điều kiện lấy: `sigmet.from <= firExit + 30′ && sigmet.to >= firEntry − 30′`; biên 30′ là hằng số có tên.
- Khung giờ FIR dùng lại `firWindows` / `parseEetFirTimes` trong `port/notam_check_tune.ts` (đã dùng cho NOTAM tune); giờ gốc lấy ETD/ETA như `flightWindowOf` để chuyến delay tính đúng. Thiếu ETD thì không lọc được → ghi "chưa xác định giờ bay", không đoán.
- Giờ hiệu lực SIGMET: NOAA có sẵn `from/to`; với văn bản FliteBrief, đọc `VALID ddhhmm/ddhhmm` và suy ra tháng/năm theo ngày bay (xử lý qua tháng).
- `src/lib/tool/briefing-data.server.ts`: thêm bộ đọc SIGMET theo FIR, dùng lại `fbJson` (chỉ trong `flitebrief.server.ts`) với timeout/cache như `portalCount`; dự phòng NOAA dùng lại `sigmetItems` trong `port/sigmet.ts`, lọc theo `fir`. Lớp SIGMET trên bản đồ NOTAM không đổi.
- `src/lib/tool/port/briefingRelease.ts`: `draftFromFlight` nhận thêm `sigmetFor(...)` và điền `sheet.sig_wx` sau `buildSheet`, trước khi áp `loadEdits` để chỉnh tay đã lưu vẫn thắng.
- `port/briefingPrevious.ts` không khôi phục `sig_wx` cũ (giữ nguyên quy tắc: WX lấy mới).
- `briefingPdf.ts`: dòng En-route SIG Wx đã tự xuống dòng/chia trang, chỉ kiểm tra lại với nội dung dài.
- Kiểm thử trong `port/__tests__/briefing_sigmet.test.ts`: SIGMET trùng giờ trong FIR → lấy; hết hạn trước giờ vào hơn 30′ → bỏ; bắt đầu sau giờ ra hơn 30′ → bỏ; trong biên 30′ → lấy; cùng SIGMET nhưng chuyến delay vào khung → lấy; FIR đọc được nhưng trống → NIL; FIR không đọc được → không NIL; không in nguồn; sửa tay được giữ; fixture `quick_pack_vj5288.txt` cho mục "FIR SIGMET Information".
- Ghi một dòng quy tắc vào `AGENTS.md` và lưu yêu cầu vào memory.
