# Roadmap — Dispatch Board web app

- [x] Phase 1: Đăng nhập + phân quyền (admin/dispatcher), bảng chuyến bay FliteBrief, chi tiết fuel/crew/tài liệu/lịch sử, tải PDF hàng loạt (zip), nhật ký hoạt động
- [x] Giao diện mới: theme đỏ Vietjet, hàng tab, pill Ca sáng/Ca đêm, Quản trị tách trang riêng
- [x] Tab Giao ca: Nạp theo DSP, tick ATC/EZFW/ATFM, lưu, xuất Excel
- [x] Tab Dữ liệu so sánh: Excel ↔ FliteBrief (crew/reg, gắn cột, xuất Excel) + so 2 bản kế hoạch (đổi tàu/crew/delay, gợi ý CHG/DLA)
- [ ] Tab ATC: check FPL trên AviWeb — CHẶN: AviWeb là ứng dụng Vaadin, bắt buộc trình duyệt thật (Selenium) như tool gốc; web không chạy được → cần trợ lý PC hoặc dán kết quả thủ công (tab Check ATC avi đã có)
- [x] Tab Notice: luật notice chỉnh được (lưu chung cả nhóm) + kiểm tra đính kèm theo chuyến
- [x] Tab Tàu/Defect: kiểm tra giới hạn (defect, APU, curfew, sân đóng, loại tàu+sân) + sửa danh sách chung
- [x] Tab Tạo KHB/FPL: sinh FPL text + FPL.req từ chuyến FliteBrief, bảng tra Sohee
- [x] Tab NOTAM, Công cụ hỗ trợ (PIB/WX)
- [ ] Phase 3: Công cụ hỗ trợ — tải WX từ các đài khí tượng (TSN, Đà Nẵng, Nội Bài)
- [ ] Phase 4: PIB (Outlook/OWA) — CHẶN: tài khoản VietJet bắt đăng nhập qua hệ thống nội bộ (ADFS), máy chủ web không tự đăng nhập được; cần IT cấp quyền ứng dụng (Azure app + Mail.Read) hoặc trợ lý PC
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
- [~] fpl (bảng tra + export xong; còn extra/pld/msg/atc_chg/version/chg, AviWeb): /api/fpltext/* (fpl_tool, atcfpl, atc_chg, atc_fix, pcr_limits), version/chg
- [~] notam (lookup + pins xong; còn check/track/tune): notam_check, notam_track, notam_pin (/api/notam/*)
- [ ] aip: aip_* (/api/aip/*, notam/vnchart)
- [~] wx (TAF status/refresh thật xong; còn metwx/pib/briefing): taf, metwx, extra_wx, wx_overlay, graph_pib, briefing, briefing_release (/api/taf/*, /api/wx/*, /api/briefing/*, /api/pib/download)
- [~] excel (upload/rows/compare + handover xong; còn crew/bind, xlsdiff version): excelcmp, xlsdiff, handover (/api/excel/*, /api/version/*, /api/handover*)
- [~] limits (/api/limits* xong; còn defect_pdf/defect_summary): /api/limits*, /api/defect/* (defect_summary, defect_pdf)
- [~] notices+swap (rules/preview xong; còn attach/auto, swaps): notices, attach/auto, regswap, briefswap, crewswap, verify, crew plan/add, split-regnotice, pdf/merge
- [ ] atc+autoload+misc: atc_check, atc files/submit, atcezfw, omni, owa, gd, credentials, paths, chat, dsp-layout, disk/clean, download
- [x] Tài khoản dịch vụ đã có trong kho bảo mật (04/10): VJC, OMNI, OWA/Outlook (hộp chung omc@), AviWeb, JetPlan, Opscore, gate
- [x] OMNI nối xong (04/10): đăng nhập thật OK, /api/est/status|refresh|match chạy thật, cache "omni.cache"; khung Cargo·Load + EST dùng dữ liệu này; còn upload XLSX tay + tự tải về ổ D: (trợ lý PC)
- [~] AviWeb: logic phân tích FPL đã port; tự đăng nhập CHẶN (Vaadin bắt buộc trình duyệt) — đang hoàn thiện test + thông báo rõ ràng trên nút
- [~] Outlook/OWA: logic đọc thư FPL/PIB đã port + endpoint sẵn; đăng nhập CHẶN (ADFS nội bộ) — cần IT cấp Azure app hoặc trợ lý PC
- [x] JetPlan (thông số tàu: MAX FUEL CAP, MTOW, MLWT, FPM) + Opscore (STATUS OOOI) đã nối thật
- [ ] Ảnh gốc còn thiếu (logo VJ, hello-kitty, cat-paw, notam-apron-tower, acft, flags, hanyi/*.png) — cần bạn gửi thư mục static
- [x] Trợ lý PC (04/10): bảng pc_jobs + token PC_AGENT_TOKEN + route /api/public/pc-agent/poll|report; endpoint /api/gd/printers|printer|print, /api/paths(|pick), /api/omni/auto đã port — in GD tới RICOH, chọn thư mục, ghi Omni xuống D:\Omni chạy qua trợ lý; script pc-agent/pc_agent.py (bản tải về ở Files/pc-agent)
- [x] AviWeb check ATC qua trợ lý PC (04/10): /api/atc/check + job atc_check giao lệnh aviweb_check cho pc_agent.py — chạy atc_check.py gốc bằng Selenium trên máy công ty, cần PC_TOOL_DIR
## Thêm mới (20:45)
- [x] Tham khảo thiết kế properprompts.ai — áp lớp poster đỏ vào /tool (13:50)
- [x] Badge số trên tab (Hiển thị chung...) bị che — sửa cho hiện đủ
- [ ] Redesign toàn bộ bảng + nút (hiện đại, chuyên nghiệp, sáng) — chờ user chọn phong cách; không Publish khi chưa được yêu cầu
- [x] Đổi BỐ CỤC thật (không chỉ màu): tab thành menu dọc trái, header gọn 1 hàng
- [x] Phác thảo thêm và áp mẫu phím vuông buồng lái, giữ Dispatch Board ở giữa
- [x] Dựng header VietJet bằng thành phần thật: 6 bộ lọc, 8 nút, thời tiết TP.HCM và đồng hồ trực tiếp
- [x] Version badge (bottom-right of tool) — bump V number in src/tool/page.html #appVersion on every publish
- [x] Popup NOTAM khi click vùng: dời khung trắng sang mép phải bản đồ
- [x] Mặc định TẮT các đài VN trên bản đồ Check NOTAM (tick "Đài" để bật)
- [x] Briefing: đối chiếu nguồn Python, nối TAF/limits/NOTAM ghim cho draft–export–đổi tàu; PDF ba cột Letter giữ đầy đủ tiếng Việt; 8 tests đạt, kiểm tra chuyến thật soạn–lưu–đọc lại–xuất–bỏ hiệu chỉnh. Chưa publish; không tự ghi NIL NOTAM khi chưa có dữ liệu portal.
- [x] Tóm tắt NOTAM: mỗi mục chỉ liệt kê 1 NOTAM một lần.
- [x] Omni: máy chủ cloud bị Omni từ chối tạo phiên (IP quá dài) → dùng phiên 30 ngày lưu chung + đăng nhập từ trình duyệt.
- [x] NOTAM vùng có cạnh là cung tròn (P4899 LION-WEST): vẽ cung thay vì coi tâm là đỉnh; SUP chỉ thay hình khi đúng tên vùng.
