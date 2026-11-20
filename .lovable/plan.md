# Cảnh báo thời tiết xấu ngay trên ô sân bay (tab Kế hoạch bay)

## Có làm được không
Được. Mỗi chuyến trong KHB đã nhận sẵn kết quả TAF theo đúng giờ (sân đi theo ETD, sân đến và các sân dự bị theo ETA), kèm trạng thái: **tốt / xấu / NIL / chưa có TAF**. Hiện chỉ dùng khi rê chuột, nên chỉ cần tô màu ô là thấy ngay.

## Cách hiển thị
- **WX xấu** (dông TS, CB, sương mù, tầm nhìn/trần mây thấp, gió giật kèm mưa dông — đúng quy tắc đang dùng để tính extra): viền đỏ + nền đỏ nhạt, góc ô có dấu ⚠ nhỏ, nhấp nháy nhẹ vài giây đầu rồi đứng yên để không rối mắt.
- **TAF NIL / ngoài giờ hiệu lực TAF**: viền cam, dấu "NIL" nhỏ ở góc — để biết cần tra nguồn khác.
- **Chưa có TAF**: viền xám đứt nét.
- **WX tốt**: giữ nguyên như hiện tại (không tô thêm cho đỡ rối).
- Áp dụng cho các ô DEP, ARR, ALT1, ALT2, TALT.
- Rê chuột vẫn hiện bảng giới hạn sân + TAF như cũ; thêm 1 dòng tóm tắt lý do lên đầu (vd. "⚠ WX xấu tại 22:25Z: TEMPO dông/TSRA, tầm nhìn 1500 m").
- Màu báo thay đổi tàu/crew và LIMIT sân hiện có không bị đè: cảnh báo WX dùng viền/dấu góc riêng.

## Khi nào cập nhật
Mỗi lần bảng KHB nạp/đối chiếu TAF (như hiện tại), màu ô tự đổi theo TAF mới nhất. Không gọi thêm dữ liệu ngoài.

## Kỹ thuật
- Dữ liệu: `st.tafPlaces[].status` (`ok|bad|nil|missing`) + `why`, từ `fpl_tool.taf_at` → `taf.adviceWindow`; không đổi ngưỡng.
- Module mới browser-safe `src/lib/tool/port/khb_airport_wx.ts`: hàm `wxMark(place)` → `{level, label, why}`; patch tool-page (sau `khb_airport_hover`) để `ftTafBox`/ô DEP-ARR thêm class `ft-wx-bad|ft-wx-nil|ft-wx-missing` và dòng tóm tắt trong tooltip; repaint khi `tafPlaces` cập nhật.
- CSS bằng token có sẵn trong tool page; dấu góc dùng pseudo-element không chặn hit-testing.
- Test vitest: bad→đỏ, nil/ngoài TAF→cam, missing→xám, ok→không tô.
- Tăng phiên bản V 7.16, cập nhật AGENTS.md trong `src/lib/tool/`.
