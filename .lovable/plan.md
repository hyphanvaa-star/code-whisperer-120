# Thanh tab NOTAM toàn màn hình: to hơn, hiện tên tab (V 6.75)

## Kết quả
- Thanh tab bên trái khi NOTAM toàn màn hình rộng ra khoảng 200px.
- Mỗi tab hiện **biểu tượng + tên tab** đầy đủ (Flight Supervisor, NOTAM Tracking…), chữ rõ dễ đọc, nút cao như bình thường; tab đang chọn vẫn đỏ.
- Danh sách NOTAM và bản đồ dịch sang phải tương ứng, không bị che.

## Technical details
- `src/routes/tool-page.ts`, khối CSS `body.nm-full`: rail width 64px → 200px; bỏ `font-size:0` và luật ẩn `.mode *`; `.mode` width 100%, height ~44px, căn trái, gap icon/chữ, chữ ~13px nowrap ellipsis.
- `.body` padding-left 72px → 208px; appVersion V 6.75; cập nhật rule trong `src/routes/AGENTS.md`.
