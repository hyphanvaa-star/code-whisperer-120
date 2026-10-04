# Làm lại cho đủ và đúng như tool gốc

## Thừa nhận hiện trạng (đã đo lại)
- Tool gốc: khoảng 75.000 dòng Python ngoài phần giao diện (web.py 35.012 dòng), 80 module, 321 file JSON dữ liệu, **1.501 bài kiểm tra tự động** trong thư mục `tests/`.
- Webapp hiện tại: khoảng 6.000 dòng. Bạn nói đúng: mới được khoảng 10–20%, và nhiều chỗ chỉ "giống bề ngoài", chưa chạy đúng logic gốc.
- Lý do chính: trước giờ chỉ đọc web.py + vài file chính, chưa port các module nền (`api/ofp.py`, `api/verify.py`, `models/*`, `config.py`, `taf.py`, `notam_check.py` 3.807 dòng, `notam_track.py`, `aip_*`, `atcfpl.py`, `atc_fix.py`, `briefing_release.py`…), và **chưa dùng bộ test gốc để đối chiếu**.

## Cách làm mới: lấy bộ test gốc làm thước đo "chính xác"
1. Mỗi module Python được chuyển sang TypeScript **giữ nguyên tên hàm, luật, ngưỡng, thứ tự xử lý**.
2. Chuyển luôn các file test gốc tương ứng sang test của webapp. Module chỉ được tính "xong" khi **qua hết test gốc của nó**.
3. Nạp nguyên các file dữ liệu gốc vào app (fpl_tool.json, limits.json, pcr_limits.json, aip_airac.json, thư mục data/aip_*, data/fpl, mẫu TAF…), không gõ tay lại.
4. Sau mỗi tab: chụp so sánh cạnh nhau với tool gốc trên cùng chuyến bay (qua link tạm của bạn khi có).
5. roadmap.md ghi số test đã qua / tổng cho từng module để bạn theo dõi.

## Thứ tự làm (theo phần dùng hằng ngày, phần nền trước)

| Bước | Nội dung | Module gốc | Test gốc |
|---|---|---|---|
| 1 | Nền dữ liệu: đọc OFP, trạng thái chuyến, đính kèm, verify | api/ofp, api/verify, models/flight, models/attachment, config | attch_check, ofp_limits, takeoff_alt_limits, flt_status, ops_status, extra_minutes, verify_* |
| 2 | Hiển thị chung đầy đủ | web.py (board), api/opscore, regswap, crewswap, briefswap, atfm, crew | general_bang, general_flash, toolbar_buttons, tools_bar_and_dsp, crew_*, regswap, atfm, page_tooltip |
| 3 | Tạo KHB đầy đủ + điện văn CNL/DLA/CHG | fpl_tool, atcfpl, atc_chg, atc_fix, pcr_limits | fpl_tool, atcfpl_widgetset, atc_chg, atc_fix, pcr_limits, fuel_cap, flight_plan_tab |
| 4 | Giới hạn tàu và sân bay + defect | limits_check, defect_summary, defect_pdf | ofp_limits, limits_low_egt, defect_summary, defect_pdf |
| 5 | Check NOTAM + AIP | notam_check, notam_track, notam_pin, aip_sup/ats/enr/rffs/sua/jp/vn_chart/lookup/airac | notam_check, notam_track, notam_pin, aip_* |
| 6 | WX / PIB / Briefing | taf, metwx, extra_wx, wx_overlay, graph_pib, pib_import, briefing, briefing_release | taf_*, extra_wx, wx_overlay, pibwx_attach, briefing_* |
| 7 | So sánh Excel + Ver + Giao ca | excelcmp/compare+reader, xlsdiff, handover | compare_*, xlsdiff_etd, version_*, handover, delete_excel_row, flytime_compare |
| 8 | Check ATC avi | atc_check | atc_check_verdict, atc_reg_check, aviweb_session |
| 9 | Tự động tải | atc_ezfw, owa_fpl_watch, omni, omni_watch, gd_print | atc_ezfw, owa_fpl_watch, omni_window, gd_print |
| 10 | Thiết lập file add + AI chat | notices, ai_chat | notice_route_choice, ai_chat |

## Phần không chạy được trên web (sẽ ghi rõ, không giả vờ chạy)
- Đọc Outlook trên máy, điều khiển Chrome, in ra máy RICOH, ghi ổ D:, đài khí tượng/trang nội bộ chỉ vào được trong mạng công ty → làm qua trợ lý PC nhỏ (bước sau cùng).
- Cần bạn cung cấp: tài khoản AviWeb, hộp thư chung (OWA), tài khoản OMNI — gửi từng cặp trong chat để lưu vào kho bí mật.

## Chi tiết kỹ thuật
- Logic thuần đặt trong `src/lib/port/<module>.ts` (dùng được cả server lẫn trình duyệt); gọi FliteBrief qua server fn có `assertDispatcher` như hiện tại.
- Test gốc chuyển sang `src/lib/port/__tests__/*.test.ts` chạy bằng vitest; fixture gốc (OFP mẫu, HTML TAF, _sample_gantts.json) copy vào `src/lib/port/__fixtures__/`.
- JSON dữ liệu lớn (fpl_tool.json 430KB, aip_*) nạp vào bảng `app_settings`/bảng riêng để cả nhóm sửa chung; bản gốc giữ làm mặc định.
- Mỗi bước kết thúc bằng: test qua hết, build sạch, mở thử trên trình duyệt với chuyến thật.
