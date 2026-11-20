# Thu nhỏ máy bay trên header và dời sang phải 3cm

Máy bay nằm chung trong ảnh nền của header, nên muốn thu nhỏ máy bay thì phải thu nhỏ cả ảnh nền.

## Thay đổi
- Thu nhỏ ảnh nền còn khoảng 85% (máy bay nhỏ lại tương ứng).
- Dời ảnh sang phải khoảng 113px (≈ 3cm trên màn hình).
- Phần trống lộ ra do ảnh nhỏ lại sẽ được lấp bằng chính ảnh đó phóng to và làm mờ phía sau, nên header không bị khoảng trắng.
- Chữ, logo, thanh lọc, giờ/thời tiết giữ nguyên vị trí.
- Nâng phiên bản lên V 7.07, chụp lại header để kiểm tra.

## Chi tiết kỹ thuật
- `src/routes/tool-page.ts`, rule `header#mdRoom`: đổi sang 2 lớp nền — lớp trên `var(--airport-clean)` với `background-size:auto 85%`-kiểu tỉ lệ, `background-position:calc(50% + 113px) center`; lớp dưới cùng ảnh `cover` qua `::after` có `filter:blur(...)` và z-index dưới nội dung.
- Kiểm tra bằng Playwright ở 1920 và 1366.
