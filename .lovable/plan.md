# Chọn route KAPLI theo giờ tới điểm KAPLI

## Luật mới
- Giờ tới KAPLI = STD UTC + "Thời gian tới KAPLI" của route (nhập trong bảng Route).
- Nếu giờ tới KAPLI **trước 1700Z** (không buffer) → lấy cột KAPLI; từ 1700Z trở đi → lấy cột ENVAR.
- Cộng qua nửa đêm vẫn tính đúng (vd STD 2330Z + 1:00 = 0030Z hôm sau → coi là sau 1700Z, đi ENVAR).
- Route chưa nhập thời gian tới KAPLI → giữ luật cũ (STD đến 1500Z lấy KAPLI, sau đó ENVAR).
- Route không có trong bảng → vẫn để 1 như hiện nay. Anh nhập tay số route trên FPL thì vẫn giữ số anh nhập.

## Bảng Route
- Thêm cột **TIME TO KAPLI** (dạng H:MM, vd 1:18) giữa ENVAR và OPT; ô trống được phép.
- Dòng ghi chú đầu bảng đổi thành: "STD UTC + thời gian tới KAPLI trước 1700Z lấy cột KAPLI, sau đó lấy ENVAR. Route chưa có thời gian thì dùng mốc STD 1500Z."
- Dữ liệu cũ giữ nguyên, các route hiện có chỉ cần nhập thêm thời gian.

## Kỹ thuật
- `port/fpl_tool.ts`: `_suffix(routeTable, route, etdHhmm)` đọc thêm `rec.kapli_time`; parse H:MM/HHMM → phút; nếu có thì `(etd + t) % 1440 < 1020` → kapli; không thì luật 1500 cũ. Bảng đọc/ghi route (~dòng 300) thêm cột `KAPLI TIME` và trường `kapli_time`.
- `src/lib/fpl.ts` `suffix()` (bản client) áp cùng luật; kiểu `suffix` thêm `kapli_time?`.
- Giao diện bảng Route (popup Database) thêm cột qua shim hiện có, không sửa trực tiếp page.html.
- Test trong `__tests__/fpl_tool.test.ts`: 1440Z + 1:47 = 1627Z → KAPLI; 1600Z + 1:18 = 1718Z → ENVAR; 1500Z + 2:00 = 1700Z → ENVAR; không có thời gian → luật 1500 cũ.
- appVersion → V 6.76, ghi rule vào `src/lib/tool/AGENTS.md`, cập nhật roadmap.
