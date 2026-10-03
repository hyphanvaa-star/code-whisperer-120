# Dispatch Board web — giao diện mới + 7 tab chạy thật

## Ý tưởng chính
Bản gốc (web.py, ~35.000 dòng, ~140 chức năng) có nhiều việc chỉ làm được trên máy tính trong công ty: Outlook, Chrome tự động, máy in, file Excel trên ổ đĩa. Vì vậy chia làm 2 phần:

```text
Trình duyệt dispatcher ──> Web app (đăng nhập, phân quyền, nhật ký)
                               │  ├─ FliteBrief: gọi thẳng từ máy chủ web
                               │  └─ Việc cần PC: chuyển tiếp có khoá bí mật
                               ▼
                     "Agent" = chương trình Python gốc chạy trên PC công ty
                     (Outlook, Chrome, in GD, file Excel, NOTAM/ATC tool)
```

Agent chính là tool Python bạn đang có, thêm 1 lớp khoá bảo vệ nhỏ, mở ra ngoài bằng cloudflared (như lúc gửi code). Web app không bao giờ để trình duyệt gọi thẳng agent.

## Thay đổi giao diện
- Theme sáng, hiện đại, đỏ Vietjet #c41e3a, logo VJ từ bản gốc; giữ font IBM Plex Sans + JetBrains Mono, giờ UTC.
- Header: logo, đồng hồ UTC, nút **Ca sáng / Ca đêm** dạng pill, trạng thái agent (online/offline), tài khoản.
- Hàng tab giống bản gốc: Hiển thị chung · Dữ liệu so sánh · Công cụ hỗ trợ · NOTAM · Tạo KHB · Giao ca · Tàu/Defect · Notice · ATC.
- **Quản trị** tách ra trang riêng `/admin` với layout riêng (không nằm trong hàng tab), chỉ admin thấy link.

## Các tab (đều chạy thật, không trang trí)
1. **Hiển thị chung** — danh sách chuyến + bộ lọc dispatcher, khung chi tiết FLT / OFP / MEL, tải PDF hàng loạt với tiến độ trực tiếp (giữ logic phase 1, dựng lại giao diện).
2. **Dữ liệu so sánh** — nạp Excel, chọn sheet/cột, so với FliteBrief, tô ô lệch (chạy trên web, không cần agent).
3. **Công cụ hỗ trợ** — tải PIB / WX theo danh sách chuyến: gửi lệnh cho agent, theo dõi tiến độ trực tiếp.
4. **NOTAM** — Check NOTAM, Track NOTAM theo chuyến; bản đồ chỉ vẽ lớp GeoJSON agent trả về.
5. **Tạo KHB / FPL text** — build, route, alt, extra, taxi, PCR, xuất text (qua agent vì cần file sohee và dữ liệu AIP).
6. **Giao ca** — trống cho tới khi chọn DSP và bấm **Nạp**; ô tick ATC / EZFW / ATFM, ghi chú; lưu lại trên web để ca sau xem.
7. **Tàu/Defect, Notice rules, ATC check, In GD, nháp ATC+EZFW** — các nút gọi agent; in và Outlook vẫn diễn ra trên PC.

Khi agent offline: các nút cần agent bị mờ kèm dòng "Agent trên PC chưa kết nối", các tab khác vẫn dùng bình thường.

## Thứ tự làm
1. Theme + header + hàng tab + tách trang Quản trị.
2. Cầu nối agent (cấu hình địa chỉ + khoá trong trang Quản trị, kiểm tra trạng thái, chuyển tiếp, luồng tiến độ trực tiếp) + script bọc agent cho PC.
3. Tab 1, 2, 6 (đủ dùng không cần agent).
4. Tab 3, 4, 5, 7 nối với agent, đối chiếu từng nút với web.py gốc.

## Chi tiết kỹ thuật
- Proxy: server route `/api/agent/$` xác thực bearer + `assertDispatcher`, thêm header `X-Agent-Key`, chuyển tiếp tới `AGENT_URL`; hỗ trợ SSE pass-through cho `/api/stream`, `/api/notam/track/progress`. Secrets `AGENT_URL`, `AGENT_KEY`.
- Agent wrapper: `agent_guard.py` chạy web.py gốc phía sau, từ chối request thiếu `X-Agent-Key`, chỉ nghe localhost; kèm hướng dẫn chạy cloudflared trên Windows.
- Bảng mới `handovers` (ca, ngày, dsp, dữ liệu JSON, người tạo) RLS cho dispatcher; `activity_log` ghi mọi lệnh gửi agent.
- Excel compare chạy trên trình duyệt (SheetJS) + dữ liệu chuyến từ server fn hiện có.
- Ghi quy tắc agent vào AGENTS.md.

## Cần bạn làm
- Chạy agent trên PC công ty khi muốn dùng tab 3–7 (mình gửi hướng dẫn từng bước).
