# Roadmap — Dispatch Board web app

- [ ] KHB CAPT/FO: tối đa 30 ký tự gồm ID/khoảng trắng; tên dài từ 3 cụm giữ đầu/cuối, áp dụng nạp/chọn/sửa và REQ.

- [x] Sửa cắt EZFW ở Tự động tải và Tạo EZFW KHB: dùng chung cách khôi phục tọa độ PDF, giữ cột/dòng trống/chữ ký theo TXT mẫu; 17 kiểm thử đạt, gồm PDF có thứ tự chữ đảo và khoảng trắng bị tách; build OK. Chưa thử thư nháp/OFP thật tại máy người dùng.
- [x] KHB V 1.8: nút Tạo EZFW nhập nhiều chuyến, đối chiếu ngày/chặng/tàu của cả sector và nội dung PDF; 14 kiểm thử đạt với hai TXT mẫu, hộp nhập đã kiểm tra; dùng trợ lý hiện tại lưu ATC/EZFW xuống D:\ATC-EZFW, dự phòng C.
- [ ] KHB EZFW: thử OFP FliteBrief thật và xác nhận file trên D/C — cần phiên đăng nhập của người dùng và trợ lý PC tại máy; không tạo được phiên theo tài khoản Lovable hiện tại.

- [x] EST KHB V 1.7: lưu STD riêng theo tên cột; khớp Omni theo STD trước ETD, lấy giờ gần nhất duy nhất cùng chuyến/ngày/chặng; 32 kiểm thử đạt, VJC774 EST 15.040 kg và REQ vẫn ETD 16:30.
- [ ] EST KHB: thử VJC774 từ phiên thật — cần người dùng đăng nhập preview; tài khoản Lovable hiện tại không khớp tài khoản web.

- [x] PIB/WX: chỉ đọc E.T.D. của WX và SYSTEM TIME/BULLETIN VALIDITY PERIOD của PIB trên trang đầu; bỏ mốc METAR/TAF/NOTAM, 14 kiểm thử đạt giới hạn 4 giờ; nhật ký ghi rõ nguồn giờ, V 1.6.
- [ ] PIB/WX: thử đính kèm hai PDF thật theo ảnh — cần file PDF thực tế và Trợ lý PC của người dùng; ảnh hiện tại chỉ là mô tả trường cần đọc.

- [x] BF: đọc NOTAM/NOTES/Permits từ PDF cũ trước khi đổi tàu, WX lấy mới; bỏ note mẫu khi tạo mới; kiểm thử giữ 6 ô và trang tiếp nối đạt, PDF tạo mới/đổi tàu không tràn chữ.
- [ ] BF: thử đổi tờ thật trên FliteBrief — chờ người dùng đăng nhập preview; không tạo được phiên cho tài khoản Lovable hiện tại. Không xoá BF cũ khi đọc thiếu ô.

- [x] Khôi phục 13 LOW EGT có sẵn trừ A649, giữ 56 dòng khác; tải/mail PDF giữ dòng tự nhập và thay summary cũ; 22 kiểm thử đạt, trang nhận bảng gộp, build OK.
- [ ] Thử tải defect summary qua Outlook thật — chờ đăng nhập preview và trợ lý PC tại máy công ty.

- [x] Tài khoản: sửa lỗi sessionless getUser, thêm chọn/xóa ảnh riêng, đồng bộ header/chat; 5 regression tests đạt, build OK.
- [ ] Tài khoản: đổi tên/mật khẩu đã lưu được bằng phiên thật (12/10); còn thử tải ảnh đại diện rồi reload; hộp thoại đã hiện danh sách yêu cầu mật khẩu (src/lib/password-rules.ts, 5 tests).

- [x] PLD: bỏ dữ liệu mẫu cho làm tròn và xem/xuất FPL; khớp Omni đúng ngày/chặng; 13 kiểm thử đạt, gồm PAY xuất của 813/970/120 ngày 12/10; đã publish V46.
- [ ] PLD: xuất lại FPL từ phiên người dùng thật — chờ người dùng kiểm tra trên live (không tạo được phiên cho tài khoản yêu cầu).

- [x] GD in dọc: áp giấy/hướng trước fit, gộp vùng in tách, kiểm tra số trang trước khi in; sheet 5 dùng Zoom đo thật + kiểm PDF, 7 tests đạt, gói AGENT v48 (nhật ký ghi "In GD bản v48" + Zoom đã dùng) đã cập nhật; chưa publish.
- [ ] Thử GD in dọc trên Excel/RICOH thật — chờ người dùng cập nhật AGENT và thử tại máy công ty.

- [x] AFTN filling: nạp danh bạ TXT người dùng và tách CODE / địa chỉ thành hai cột sửa được, giữ cách xuất TPL hiện có; chưa publish.

- [x] Checklist: thêm lựa chọn Normal/EDTO; mẫu F-018 gốc, YES ở dòng nội dung và mục độc lập, Extra Fuel for EDTO tích NO, DSP/license dưới REMARK; thử hai chuyến mẫu tải PDF hai trang, kiểm tra mọi vị trí tích và xem ảnh cả hai trang không thấy tràn/đè chữ; Normal vẫn tải đúng. Chưa publish, chưa thử chuyến thật.

- [x] Checklist KHB: một PDF mỗi chuyến, dấu ✓ đúng ô (II.3/4 ở dòng nội dung), DSP License thành ô nhập; thử hai chuyến mẫu tải hai PDF, xem đủ trang, sửa font tên tiếng Việt và tràn trang của mẫu; kiểm tra ô nhập trong iframe thật. Chưa publish.
- [ ] Checklist với chuyến thật từ tài khoản người dùng — chờ đăng nhập preview; không tạo được phiên cho tài khoản Lovable yêu cầu.

- [x] Mẫu màu nút Công cụ hỗ trợ: thêm 3 ảnh phác thảo (4–6), đã kiểm tra ảnh; chưa áp dụng lên web.

- [x] Check ATC: màu kết quả đậm, đồng đều giữa các hàng; ô thiếu dữ liệu của dòng có chuyến hiện “- - - -”; kiểm tra giao diện sáng/tối đạt, không đổi dữ liệu thật; chưa publish.

- [x] KHB: nạp/chọn Crewlist làm mới danh sách và bỏ chuyến ngày cũ; thử giao diện ngày 9 → 10 đạt, chưa thử file thật của người dùng.

- [x] Auto Rounding PLD: nhận diện theo số chuyến/ngày/chặng/ETD thay vì chỉ số dòng Crewlist; 17 tests đạt, kiểm tra nút PLD trong trình duyệt đạt.
- [ ] Auto Rounding PLD: thử chuyến thật trên preview — chờ người dùng đăng nhập, không tạo được phiên cho tài khoản yêu cầu.

- [x] Đối chiếu gói tóm tắt NOTAM gốc: phục hồi đánh giá từng chuyến và gộp cả ca; kiểm tra vùng/giờ/ATS/RWY, bỏ tóm tắt suy diễn từ hit_count; 28 tests đạt.
- [ ] Thử tóm tắt NOTAM với ca bay thật — chờ người dùng đăng nhập preview; không tạo được phiên kiểm tra cho tài khoản Lovable hiện tại.

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
- [~] notices+swap (rules/preview/notice attach xong, file notice lấy từ kho máy chủ; còn attach/auto, swaps): notices, attach/auto, regswap, briefswap, crewswap, verify, crew plan/add, split-regnotice, pdf/merge
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
- [x] Publish V3 với slug `sohee-dispatch-tool-v3` (user muốn tên URL có version)

- [x] Trợ lý PC v1.5: mọi đích D:\ (FPL, Omni, GD, PIB) tự rơi về C:\ khi máy không có ổ D; web hiển thị đường dẫn thực tế.
- [x] Route check trên bản đồ: bỏ viền đen (halo) quanh đường vàng, giữ nguyên đường vàng.
- [x] Đối chiếu goi-ve-vung-notam.zip: bổ sung parser tọa độ/cung/nhiều vùng, Japan ENR/SUP và KOCA ENR; kiểm tra thực tế VJC822/VJC834. VJC834 còn 1 chấm cam D2983/26 chưa xác định được đường bao từ nguồn, không tự bịa hình; chưa publish.
- [x] So sánh VJC834: Tracking thiếu apply24h nên lấy ALL; sửa trước đếm/vẽ. Kiểm tra thực tế còn 1154 NOTAM so với ảnh cũ 1152 (nguồn thay đổi + VVHM thêm); bộ lọc và parser có regression tests.

## Giao diện đăng nhập / nền trang
- [x] Nền đăng nhập mới: wash đỏ + chấm lưới + mạng đường bay/vòng radar (kiểm desktop + mobile)
- [x] Bỏ ô nhập email (Chrome hay gợi ý tài khoản trong ô đó) — đã thay bằng ô 'ID tài khoản'
- [x] Đăng nhập chỉ cần ID + mật khẩu: ID 'hyphan'/'roise' tự map thành <id>@app.local
- [x] Đăng nhập chỉ cần ID + mật khẩu (bỏ ô email/Gmail)
- [x] Tài khoản: hyphan (admin+dispatcher) — đã đăng nhập được bằng ID
- [x] roise / 221098 đã tạo (dispatcher); tắt kiểm tra mật khẩu yếu + tắt tự đăng ký theo yêu cầu
- [x] Publish V11 (nền đăng nhập mới + đăng nhập ID/PASS + 2 tài khoản) — live xác nhận V11
- [x] Bắt đăng nhập lại mỗi lần mở web (không giữ phiên đăng nhập sẵn)

## Giao diện nút bấm (nháp)
- [x] Đổi tên tác giả thành Hy và xoá đúng tài khoản Rosie; đã kiểm trang đăng nhập/công cụ, giữ tài khoản quản trị và dữ liệu chung.
- [ ] Mẫu nút nền đỏ chữ trắng — chỉ áp dụng trong tab "Công cụ hỗ trợ" (#wrapTool); header và các tab khác giữ kiểu cũ. Đã soi preview, chưa publish.

- [x] KHB: gõ số hiệu không có trong Crewlist thì giữ nguyên số trên bảng (trước đây tự xoá mất số); số này vẫn tính vào dòng "Tổng: N chuyến"; đã kiểm offline 7 ca (gõ, Enter, dán lẫn lộn, xoá, nạp lại), chưa publish.
- [x] Sân bay hạn chế APU: chỉ tô vàng khi tàu APU INOP hoặc REQ APU/ACU/ASU (page.html + limits_check.ts), test 17 đạt, chưa publish
- [x] Xuất full dữ liệu: soheedispatch-backup.zip (7 CSV + 251 file kho) đã gửi
