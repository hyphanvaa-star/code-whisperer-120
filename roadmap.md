# Roadmap — Dispatch Board web app

- [x] Phase 1: Đăng nhập + phân quyền (admin/dispatcher), bảng chuyến bay FliteBrief, chi tiết fuel/crew/tài liệu/lịch sử, tải PDF hàng loạt (zip), nhật ký hoạt động
- [x] Giao diện mới: theme đỏ Vietjet, hàng tab, pill Ca sáng/Ca đêm, Quản trị tách trang riêng
- [x] Tab Giao ca: Nạp theo DSP, tick ATC/EZFW/ATFM, lưu, xuất Excel
- [x] Tab Dữ liệu so sánh: Excel ↔ FliteBrief (crew/reg, gắn cột, xuất Excel) + so 2 bản kế hoạch (đổi tàu/crew/delay, gợi ý CHG/DLA)
- [ ] Tab ATC: check FPL trên AviWeb (AviWeb truy cập được từ web — viết lại không cần Selenium)
- [x] Tab Notice: luật notice chỉnh được (lưu chung cả nhóm) + kiểm tra đính kèm theo chuyến
- [x] Tab Tàu/Defect: kiểm tra giới hạn (defect, APU, curfew, sân đóng, loại tàu+sân) + sửa danh sách chung
- [x] Tab Tạo KHB/FPL: sinh FPL text + FPL.req từ chuyến FliteBrief, bảng tra Sohee
- [x] Tab NOTAM, Công cụ hỗ trợ (PIB/WX)
- [ ] Phase 3: Công cụ hỗ trợ — tải WX từ các đài khí tượng (TSN, Đà Nẵng, Nội Bài)
- [ ] Phase 4: PIB (nguồn Outlook/OWA — cần xác định cách truy cập hộp thư từ web)
- [ ] Phase 5: AIP / NOTAM / ATC FPL check, crew/reg swap, OPS core, AI chat

- [x] Quyết định: viết lại tối đa trên web; Outlook = hộp thư chung + hộp dự phòng

## Làm lại cấu trúc từng tab theo tool gốc (bản đồ giao diện: /tmp/rosie/ui-map.txt, ảnh /tmp/browser/orig)
- [x] Khung chung: thanh lọc Dispatcher/Callsign/Dep/Dest/Reg, hàng tab đúng thứ tự
- [x] Tạo KHB: lưới 30 dòng gõ Số + Enter, cột như gốc, A/C performance, tô màu giới hạn, thư viện Cost Index/Taxi/Route/ALT/ERA/PCR, Extra/Đánh số, Auto Rounding PLD, Xem/Xuất FPL.req
- [ ] Tạo KHB: Tạo điện văn CNL/DLA/CHG (cần atc_chg.py), Get ATC/Data Convert (cần AviWeb)
- [x] Hiển thị chung: cột CALLSIGN ROUTE STD/STA STATUS ALT REG LIMIT ATTCH PIB/WX TAF EXTRA DSP + chi tiết FLT STATUS/OFP/MEL/View/Check OFP
- [x] Công cụ hỗ trợ (METAR/TAF thật, PIB/WX đính kèm, log; PIB Outlook còn chờ hộp thư): 4 hàng NẠP / PIB-WX / FLITEBRIEF / KHÁC + bảng FLT NO|PIB/WX|PIB|STD|WX + khung log
- [x] Check NOTAM (NOTAM thật từ FliteBrief, 24H, mức quan trọng, bản đồ toạ độ): thanh DSP/Check/Get/Chọn chuyến/tracking + bản đồ bên phải
- [x] Dữ liệu thay đổi theo ver (tab riêng), Tự động tải (ATC+EZFW cắt từ OFP chạy thật; Outlook FPL/Omni/in GD chờ hộp thư + trợ lý PC)
- [x] Check ATC avi (dán kết quả AviWeb → REG/STD CHECK; tự lấy chờ tài khoản AviWeb): bảng # FLT NO STATUS REG REG CHECK EOBT STD CHECK DOF GHI CHÚ
- [x] Giới hạn tàu và sân bay: 4 bảng Tàu/Sân bay/Curfew/Đặc biệt + tải defect summary
- [x] Thiết lập file add: Notice Rule Studio (tổng/đang dùng/hết hạn, cột TRẠNG THÁI…NGÀY HẾT HIỆU LỰC)

## Bản đúng 100%: giao diện gốc + chuyển từng chức năng máy chủ (từ 04/10)
- [x] Hạ tầng: giao diện gốc nguyên bản ở /tool, đăng nhập thật thay gate, /api/* chung, job stream, kho file
- [~] core (bảng chuyến + chi tiết chuyến chạy thật; còn weights, extra, est, opscore/atfm đầy đủ): flights/flight/ofp, attch_check, row, limits_check, ofp, verify, opscore, atfm, crews, weights, extra, est
- [ ] fpl: /api/fpltext/* (fpl_tool, atcfpl, atc_chg, atc_fix, pcr_limits), version/chg
- [ ] notam: notam_check, notam_track, notam_pin (/api/notam/*)
- [ ] aip: aip_* (/api/aip/*, notam/vnchart)
- [ ] wx: taf, metwx, extra_wx, wx_overlay, graph_pib, briefing, briefing_release (/api/taf/*, /api/wx/*, /api/briefing/*, /api/pib/download)
- [ ] excel: excelcmp, xlsdiff, handover (/api/excel/*, /api/version/*, /api/handover*)
- [ ] limits: /api/limits*, /api/defect/* (defect_summary, defect_pdf)
- [ ] notices+swap: notices, attach/auto, regswap, briefswap, crewswap, verify, crew plan/add, split-regnotice, pdf/merge
- [ ] atc+autoload+misc: atc_check, atc files/submit, atcezfw, omni, owa, gd, credentials, paths, chat, dsp-layout, disk/clean, download
- [ ] Ảnh gốc còn thiếu (logo VJ, hello-kitty, cat-paw, notam-apron-tower, acft, flags, hanyi/*.png) — cần bạn gửi thư mục static
