# Roadmap — Dispatch Board web app

- [x] V 6.02: nút ↻ Crew/REQ hiện ngay khi FliteBrief khác Crewlist, không chờ so hai bản Crewlist; 7 kiểm thử đạt; publish.
- [x] V 5.96: nút AIMS tải Crewlist trực tiếp (Daily Flight Schedule) bằng tài khoản AIMS riêng, nạp như tải tay; thử tải thật bằng phiên AIMS của JACK đạt (90 KB, 335 chặng). Chưa publish.
- [x] V 5.99: tự quét AIMS theo chu kỳ (5/10/15/30 phút), so với Crewlist đang dùng; đổi tàu/crew/giờ thì chuông rung + kêu + thẻ báo chuyến, tự nạp bản mới. Thử giao diện bằng dữ liệu giả đạt; chưa thử với AIMS thật. Chưa publish.
- [ ] V 5.96: thử đăng nhập AIMS bằng mật khẩu thật — cần JACK lưu tài khoản AIMS trong 🔑 Tài khoản.

- [x] V 5.70: ATS route trùng tên ở FIR khác (A464 Úc/Singapore) không còn cảnh báo nhầm; 5 kiểm thử mới đạt; publish.

- [x] V 5.46: cập nhật và vẽ KHB trước đọc lịch sử Crewlist, lỗi lịch sử không chặn tàu mới; sửa giá trị tàu cũ đã lưu theo chứng cứ diff chính xác, giữ sửa tay khác; tái hiện lỗi trước/sau sửa, 27 kiểm thử đạt, thử bấm KHB trên mẫu trình duyệt đạt; chưa publish.
- [ ] V 5.46: xác nhận đổi tab KHB trong phiên JACK — chưa có phiên khớp người yêu cầu; cần JACK đăng nhập preview.

- [x] V 5.45: sửa KHB VJ362/363 giữ VN-A580 khi Crewlist mới là VN-A683; hy3.xlsx xác nhận cả hai là VN-A683, hai kiểm thử tái hiện lỗi trước sửa và đạt sau sửa, 24 kiểm thử đạt; trình duyệt thử chuỗi nạp lại đạt, chưa publish.
- [ ] V 5.45: xác nhận KHB thật của JACK — không cấp được phiên khớp người yêu cầu; cần JACK đăng nhập preview.

- [x] V 5.44: tóm tắt dùng đánh giá hiện tại theo từng sân, bổ sung đủ J2241/26 + J2240/26; 12 kiểm thử đạt, bảng đang chạy hiển thị đủ trên mẫu tái hiện; build OK, chưa publish.
- [ ] V 5.44: xác nhận VJC820 thật của JACK — không cấp được phiên khớp người yêu cầu, cần JACK đăng nhập preview.

- [x] V 5.41: summary chữ tím / tự nhập hoặc chỉnh sửa chữ đen; lưu nguồn rõ ràng, bỏ đúng 3 dòng cũ A644 APU/VN-532 APU/A816 CPC, dữ liệu còn 14 LOW EGT và 66 summary. Thử màu/sửa tay trên mẫu đạt; chưa publish.
- [ ] V 5.41: thử tải summary qua Outlook thật của JACK — không cấp được phiên người yêu cầu; cần JACK đăng nhập preview và Trợ lý PC.

- [x] V 5.39: CI tự nhận diện vùng từ quốc gia sân bay cho KHB/FPL/REQ; giữ số CI cấu hình và ngoại lệ sân; Perth A321NEO CI18 và các vùng đạt, 43 kiểm thử đạt, build OK; chưa publish.
- [ ] V 5.39: thử xuất REQ VJ92 từ bảng thật của JACK — chưa cấp được phiên khớp tài khoản người yêu cầu, cần đăng nhập preview.

- [x] V 5.27: nhãn NOTAM thiếu/mới mở danh sách đọc/copy; so lại và đánh dấu đã xem riêng, giữ NOTAM đến sau. 8 kiểm thử đạt; thử mẫu desktop/mobile, copy và đóng/Esc đạt; build OK. Chưa publish.
- [ ] V 5.27: thử Briefing pack và NOTAM mới trên chuyến thật của JACK — không cấp được phiên khớp người yêu cầu; cần JACK đăng nhập preview.
- [x] V 5.26: REG FPL/REG AIMS dùng khung sáng hai nguồn Excel xanh lá/FliteBrief xanh dương như CREW, số tàu lớn và nhãn khớp/lệch; giữ tên nguồn, OFP dự phòng được ghi riêng. 18 kiểm thử đạt, thử mẫu trình duyệt đạt. Chưa publish, chưa thử phiên JACK.
- [x] V 5.25: hover CREW nền sáng, Excel xanh lá/FliteBrief xanh dương, mỗi người riêng với vai trò/ID nếu có; giữ nguồn và kết quả. 18 kiểm thử đạt, xem mẫu desktop/mobile không tràn ngang. Chưa thử phiên JACK, chưa publish.
- [x] V 5.24: thêm nguồn FPL/Crewlist vào chú thích từng ô và tiêu đề REG FPL, REG AIMS, CREW; 18 kiểm thử đạt, thử rê chuột và đổi hy4 → hy5 bằng dữ liệu mẫu. Chưa publish.
- [ ] V 5.24: thử bảng So sánh thật trong phiên JACK — không có tài khoản ứng dụng khớp email người yêu cầu.
- [x] V 5.23: KHB chỉ đánh dấu thay đổi của cặp Crewlist mới nhất; bỏ dấu xanh/nút cũ ở ô không còn đổi, giữ chỉnh sửa và cập nhật số đếm. 21 kiểm thử đạt; trình duyệt thử dấu xanh và hai nút cũ biến mất, giữ VN-A580; build OK. Chưa publish.
- [ ] V 5.23: thử nạp Crewlist thật trong phiên JACK — không cấp được phiên khớp người yêu cầu; cần JACK đăng nhập preview.

- [x] V 5.22: gộp giới hạn sân bay và TAF vào cùng bảng rê chuột trong KHB; đã thử HUI bằng dữ liệu kiểm tra, chưa thử phiên JACK.
- [x] V 5.22: nhấn FPL VER mới mở bảng nổi dữ liệu thay đổi, đóng tại chỗ rồi chuyển nhãn xanh; 31 kiểm thử đạt, thử mở/đóng tại So sánh đạt, chưa thử dữ liệu thật do không cấp được phiên JACK. Chưa publish.
- [x] V 5.21: sửa cấu hình VVPC/VVPQ về danh sách tàu được phép đến, giữ 62 tàu; quy tắc chỉ xét sân đến, không chặn sân khác. Chưa publish.
- [x] V 5.20: rê chuột lên nhãn FPL VER (thanh So sánh và nhãn trên tab) hiện đang đối chiếu với FPL VER nào và file Crewlist nào. Chưa publish.
- [x] V 5.19: tắt tự check EOBT AviWeb nền ở tab Dữ liệu thay đổi (không còn tự gõ chuyến sang Check ATC avi); giờ chỉ chạy khi bấm nút Check ATC avi. Chưa publish.

- [x] V 5.10: CREW chuyến giao ca vẫn trống — máy chủ đọc tổ bay cho cả chuyến ngoài DSP chính, thử lại ô trống đã nhớ; crewlist hy2.xlsx thật: 58/58 chuyến có tổ bay (trước sửa thiếu toàn bộ HO). Chưa publish.

- [x] Sửa CREW chuyến giao ca: đồng bộ crew/crewnames với các dòng HO trong bảng So sánh, giữ IDs/bộ lọc khác và DSP chính; tái hiện 2 lỗi trước sửa, 31 kiểm thử đạt sau sửa, trang phục vụ đủ hai bản sửa và 16 đoạn mã hợp lệ, build OK. Chưa publish.
- [ ] Thử CREW giao ca trong phiên JACK — không cấp được phiên khớp người yêu cầu; cần JACK đăng nhập preview để xác nhận chuyến thật.

- [x] V 5.08 FPL VER 12: nhận tên FPL thiếu ON, chọn hai VER khác nhau cùng ngày, cập nhật So sánh ngay và nhãn theo file thực nạp; 26 kiểm thử đạt, trình duyệt xác nhận trước sửa 0 lượt cập nhật/sau sửa 1 lượt, 16 đoạn mã hợp lệ, build OK. Chưa publish.
- [ ] V 5.08: thử nhận mail VER 12 và đọc lại bảng của JACK — chưa có phiên đăng nhập khớp người yêu cầu; cần đăng nhập preview và trợ lý PC tại máy công ty.

- [x] V 4.89: mở rộng khung chat, giao diện Messenger, emoji lớn và nhãn dán không nền; 9 kiểm thử đạt, giữ nguyên gửi tin/reaction. Chưa thử trên phòng chat thật do không có phiên người yêu cầu.

- [x] V 4.88: thêm emoji, bốn nhãn dán hàng không và reaction tin nhắn; kiểm tra gửi/thu hồi và đọc lại bằng kiểm thử. Chưa thử hai tài khoản thật vì không cấp được phiên người yêu cầu.

- [x] V 4.64: CFP NO nháy đỏ theo đổi tàu/crew Crewlist, dùng lại xuất REQ và chỉ hết nháy sau khi tải thành công; giữ REQ tab Dữ liệu thay đổi. 30 kiểm thử đạt, build OK; chưa xuất REQ trên chuyến thật.

- [x] V 4.55: Compare chọn hai số VER khác nhau của cùng ngày, không lấy bản cũ tải lên muộn; giữ thứ tự Crewlist và xác nhận đổi tàu. Kiểm thử VER 10/09, khác ngày, bản trùng và giao năm; cần người dùng thử lại VJ155 trên chuyến thật.

- [x] V 4.51: khung thông tin ẩn không chặn chuột; toàn ô TAF ở Hiển thị chung hiện dữ liệu hiện tại hoặc thông báo thiếu TAF. Cần người dùng thử lại trên máy công ty.

- [x] V 4.18: NOTAM ↔ bản đồ mở đúng nhóm Impact/Manual/Brief/No Impact và đúng nguồn đang có; ưu tiên ranh giới thật trước điểm route, tìm cả vùng đã ẩn. 4 kiểm thử đạt, trang V 4.18 không lỗi; chưa thử chuyến thật vì không có phiên đăng nhập.
- [x] V 4.17: thay logo VJ trong thanh sân bay/FIR bằng NOTAM tổng / IMPACT / NO IMPACT của toàn chuyến; tổng gồm manual/briefing, IMPACT gồm Critical/Delay-only, NO IMPACT gồm dòng bị lọc. 3 kiểm thử đạt, trang V 4.17 và không lỗi; chưa thử phiên chuyến thật.
- [x] V 4.16: Layer có “Bật vùng ảnh hưởng toàn bộ”, khôi phục ranh giới đã lọc của chuyến đang xem; không thêm chấm thiếu tọa độ hay đổi kết quả giờ/hành lang. Thu gọn khoảng trống thanh đen; 25 kiểm thử đạt, trang phục vụ V 4.16. Chưa thử chuyến thật do chưa có phiên đăng nhập.
- [x] V 4.15: Database → Named Airspace liệt kê cùng kho 701 vùng theo 11 quốc gia/vùng lãnh thổ; tìm mã/tên/FIR, xem tọa độ/nguồn có sẵn. 22 kiểm thử đạt; thao tác chọn Philippines/tìm RP-R72/xem tọa độ đạt trên màn hình riêng, chưa thử phiên đăng nhập thật vì không có tài khoản khớp.
- [x] V 4.14: bổ sung 78 vùng xác minh từ AIP Nhật/Philippines/Đài Loan (đa giác và vòng tròn), tổng 701 vùng cùng kho cũ; tra ranh giới ngay trước tải SUP, đúng FIR, không thay vùng có hậu tố bằng vùng gốc.
- [ ] Kho vùng quốc tế: chưa có ranh giới AIP đầy đủ của Trung Quốc/Lào/Indonesia; các vùng có cung/bờ biển/lỗ loại trừ chưa đủ cách dựng hình vẫn kiểm tra tay, không đoán tọa độ.
- [x] V 4.12: nhận diện RP-R72/RPR72 và W-181/RJW-181 theo FIR; bổ sung tham chiếu P51-1 vào tra Nhật, giữ cách xét giờ/hành lang/độ cao; 34 kiểm thử đạt, trang phục vụ V 4.12.
- [x] V 4.13: đăng nhập Japan SWIM/EAD bằng tài khoản cung cấp; bổ sung W-181 theo AIP Nhật 29/10/2026 và RP-R72 theo PDF Philippines ENR 5.1-1 (trang 30/11/2023, thư viện liệt kê 30/10/2025). Lưu nguồn và tọa độ gốc, không lưu tài khoản vào mã ứng dụng; giữ quy tắc giờ/hành lang/độ cao.
- [ ] V 4.13: xác nhận hai đa giác trong Check NOTAM của chuyến thật — cần người dùng check lại chuyến có W-181/RP-R72; đã kiểm tra đường bao và bộ dựng hình bằng dữ liệu AIP.

- [x] V 3.67 / Trợ lý 6.2: bỏ hỏi thư mục tool, nhận công cụ đóng gói dạng .pyc; 25 kiểm thử đạt, gói tải trực tiếp đúng 6.2 và nhãn V 3.67.
- [ ] Trợ lý 6.2: thử cài/chạy trên Windows công ty — môi trường hiện tại không có Windows.

- [x] V 3.62: bỏ cập nhật toàn bảng trong từng ô REG, chỉ tô lại chuyến vừa check và lập chỉ mục dòng; Validation nền sáng, chữ 16–18px, sáu biểu tượng/màu riêng. 26 kiểm thử đạt, đã xem khung mẫu, trang không lỗi.
- [ ] V 3.62: xác nhận độ mượt trên danh sách chuyến thật — chưa có phiên tài khoản để thử; người dùng bấm Cmp và rê Validation.

- [x] V 3.61: sửa bảng So sánh trống vì biến đường phân cách HANDOVER đặt nhầm bảng; tái hiện lỗi trước sửa, vẽ lại chuyến đạt, 7 kiểm thử đạt và build OK.

- [x] V 3.60: trợ lý 5.9 chạy ngầm bằng Chay-Ngam.vbs, tắt bằng Tat-Tro-Ly.vbs, giữ ghép tài khoản và nhật ký; 20 kiểm thử đạt, tải đúng gói mới, trang không lỗi.
- [ ] Trợ lý 5.9: thử chạy/tắt trên Windows công ty — môi trường hiện tại không có Windows; cần người dùng tải gói và thử.

- [x] V 3.57: ô CREW/REG AIMS/REG FPL có viền bấm theo nguồn thay đổi, xác nhận và đối chiếu lại FliteBrief; 26 kiểm thử đạt, trang V 3.57 và 12 đoạn chạy hợp lệ; thử crew bằng dữ liệu mô phỏng đạt.
- [ ] V 3.57: thử chuyến thật — chưa có phiên khớp người yêu cầu; thao tác tàu hiện có chỉ đổi file đính kèm, không sửa REG/OFP trên FliteBrief.

- [x] V 3.53: dấu + trong dropdown DSP thêm/bỏ nhóm HANDOVER trên bảng So sánh; DSP chính bình thường phía dưới; 23 kiểm thử đạt, nhãn trang V 3.53.
- [ ] V 3.53: thử nhận giao ca với chuyến thật — chưa mở được phiên người yêu cầu; cần người dùng đăng nhập preview và thử dấu +.

- [x] V 3.13: nhãn OpsCore OOOI nhỏ dưới CALLSIGN ở bảng so sánh; dùng màu/trạng thái hiện có và cập nhật theo lượt nền 30 giây.

- [x] V 3.12: thêm ATC status giữa CREW/REG FPL, đọc AviWeb khi chạy Cmp; chỉ nhận kết quả đúng DOF trên chuyến/chặng đã chọn.

- [x] V 3.11: NOTE cho nhập trực tiếp, giữ khi cập nhật bảng và tải lại trên cùng trình duyệt; tách ghi chú theo tài khoản/chuyến.

- [x] V 3.10: thêm NOTE giữa EST−PLD và Validation; Điện văn sau Validation, chọn CHG A/C, DLA hoặc CHG DLA để mở khung điện văn hiện có.

- [x] V 3.09: REG FPL đọc REG trong ATC FPL và so FliteBrief, khớp chữ xanh lá; BF chỉ bật khi có bằng chứng đổi tàu, giữ xác nhận và đúng sector khai thác.

- [x] V 3.08: thêm REG FPL (FliteBrief) trước REG AIMS (Crewlist/Excel); thêm Đổi Briefing và Verify cuối bảng so sánh, dùng thao tác hiện có trên đúng chuyến; 18 kiểm thử đạt, build OK.
- [ ] V 3.08: thử Đổi Briefing/Verify trên chuyến thật — cần người dùng xác nhận thao tác ghi trên chuyến đang khai thác.

- [x] V 3.06: thu nhỏ cột PLD (76px); ô PLD thành ô nhập — sửa tay ghi vào st.est/st.pay (pldManual) nên REQ xuất theo số đã sửa; tự động lấy EST bỏ qua ô đã sửa tay.

- [x] V 3.05: bỏ hẳn cột Validation khỏi bảng KHB — bảng chỉ còn một cột PLD hiện EST Omni; gỡ toàn bộ mã đối chiếu So sánh, CSS và kiểm thử liên quan; ô PLD giữ màu xanh/đỏ và chú thích cho biết dư/vượt bao nhiêu kg.
- [ ] V 3.05: xác nhận bảng KHB chỉ còn cột PLD trên chuyến thật — cần phiên người dùng; chưa thử chuyến thật.

- [x] V 3.02: nút ✔ đỏ trước số hiệu chuyến đang có tam giác đỏ OFP mới — bấm xác nhận OK là verify → release, nút chuyển xanh ✓ khi xong; đã thêm kiểu hiển thị cho nút. 377 kiểm thử đạt.
- [ ] V 3.02: xác nhận ✔ verify trên chuyến thật có tam giác đỏ — cần phiên người dùng; chưa thử chuyến thật.

- [x] V 2.99: tia sét KHB tra sector FliteBrief mới thay số dòng Crewlist; kiểm tra crew theo mã/vai trò, chuyển xanh khi đã khớp và chặn ghi khi đọc lỗi.

- [x] V 2.93: giữ Good/Cảnh báo khi lượt kiểm tra ngầm chưa đầy đủ; chỉ đổi ô khi kết quả hoàn chỉnh thay đổi, bộ nhớ tách đúng chuyến/ngày/chặng/tàu/giờ.

- [x] V 2.91: Validation tách trạng thái/chi tiết, PLD căn hai nguồn và hiện dư/vượt kg; bổ sung múi giờ THD/VDO, 26 kiểm thử đạt và mẫu hiển thị đã kiểm tra; chưa publish.
- [ ] V 2.91: xác nhận Cmp chuyến 243 và hai cột trên chuyến thật — cần phiên người dùng; mẫu hiển thị không thay cho chuyến thật.

- [x] V 2.78: Validation lấy cảnh báo đúng chuyến từ So sánh và tự cập nhật khi kết quả về; chỉ Good nền xanh khi dữ liệu đủ và kiểm tra đạt; 8 kiểm thử đạt.
- [ ] V 2.78: xác nhận cảnh báo/Good với chuyến thật — chưa có phiên người yêu cầu; cần thử preview.

- [x] V 2.77: hiện PLD sau Validation, tăng độ rộng bảng; hai nguồn riêng payload OFP / EST Omni (15000 / 16582); xác nhận tiêu đề và 4 kiểm thử đạt, build OK.
- [ ] V 2.77: thử OFP / EST Omni với chuyến thật — chưa có phiên người yêu cầu; cần thử trên preview.

- [x] V 2.76: đổi ETP POA thành Validation, thêm PLD và lấy EST Omni theo chuyến đã chọn; giữ sửa tay và báo thiếu EST; 17 kiểm thử đạt.
- [ ] V 2.76: thử lấy EST Omni với chuyến thật — không tạo được phiên người yêu cầu; cần người dùng thử bản preview.

- [x] V 2.63: khóa chung danh sách −6/+24 cả khi dùng cache; CHG/DLA, Get ATC/CNL/CHG, AFTN, REQ, AviWeb và mail EZFW chặn ngày/chặng cũ; bỏ nhận EOBT sai DOF. 75 kiểm thử đạt, gồm VJC807 bỏ 0745 hôm trước và nhận 0830 đúng ngày.
- [ ] V 2.63: thử VJC807 thật từ Check ATC đến xuất CHG/DLA — không tạo được phiên của người yêu cầu; cần người dùng thử preview, chưa publish.

- [x] V 2.62: giữ thông tin tài khoản theo từng người khi mở lại; không lưu mật khẩu trên trình duyệt, giữ thông tin khi tải lỗi và bảo vệ ô đang sửa.
- [ ] V 2.62: thử lưu/mở lại tài khoản hyphan trong phiên thật — không tạo được phiên cho tài khoản Lovable hiện tại; cần người dùng thử trên preview, chưa publish.

- [x] V 2.61: lượt danh sách luôn lấy mới, bỏ phản hồi đến trễ/lỗi thay vì đè bằng bảng đã lọc; giữ DSP/chuyến đã chọn khi tạm thiếu, không nạp lại tab sau tracking; 6 kiểm thử đạt, chưa publish.
- [ ] V 2.61: thử DSP PHAN THANH HY và NOTAM tracking trong phiên thật — không tạo được phiên theo tài khoản Lovable hiện tại; cần người dùng thử trên preview.

- [x] V 2.14: sửa JTWC/JMA và hiện tên bão; dữ liệu thật nhận Champi (29W), Vance (22E), Agueda (02S), 36 lớp JTWC/13 lớp JMA; 9 kiểm thử đạt, thanh kéo hoạt động ở 1280px/636px với trang kiểm tra riêng, build OK; chưa publish.
- [ ] V 2.14: kiểm tra trong phiên đăng nhập của người dùng — không tạo được phiên cho tài khoản Lovable hiện tại; cần người dùng mở Bão và thử thanh kéo trên preview.

- [x] Acc V 2.7: cuộn trong khung tài khoản, giữ tiêu đề/nút đóng và chữ lớn; đã kiểm tra thấy OpsCore/nút Lưu trên máy tính 1280×800 và điện thoại 390×844; kiểm thử dấu mật khẩu đạt, chưa publish.

- [x] Acc V 2.6: giữ dấu mật khẩu sau khi lưu kể cả khi tải trạng thái lỗi; chữ nhập 19px, nhãn/nút 17px; kiểm thử và thao tác lưu/mở lại với dữ liệu kiểm tra đạt, chưa thử tài khoản thật vì không có phiên.

- [x] Outlook Web: quét nền không đổi trạng thái đăng nhập; giảm trừ hao 300→60 giây; thao tác PIB vẫn kiểm tra/làm mới phiên và giữ lỗi Microsoft; gói trợ lý 5.4 đã cập nhật, 8 kiểm thử đạt, build OK.
- [ ] Outlook Web: thử giữ phiên và tải PIB thật — cần người dùng chạy trợ lý 5.4 trên máy công ty; chưa publish.

- [x] KHB CAPT/FO: tối đa 30 ký tự gồm ID/khoảng trắng; tên dài từ 3 cụm giữ đầu/cuối, áp dụng nạp/chọn/sửa và REQ; 17 kiểm thử đạt, mẫu 9180 AUCANCELA ARMANDO đã kiểm tra trong trang KHB. Chưa thử chuyến thật.

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
- [x] V 5.15: LIMIT tàu được phép đến VVPC/VVPQ hiện xanh, ghi chú ghi rõ sân; không đổi cảnh báo khai thác khác.
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

- [x] Tài khoản: thu nhỏ ô nhập/nút trong khung 🔑 Tài khoản (chữ 16.5px, ô cao 40px, khung 880px) — đo bằng Playwright 1280x800 + 390x844, cuộn xuống thấy đủ AviWeb/OpsCore, badge V 2.20, chưa publish
- [x] Tài khoản: đưa khung Outlook lên ngay trên InFlight Omni (FliteBrief → Outlook → Omni → AviWeb → OpsCore), badge V 2.21, Playwright xác nhận thứ tự + dấu mật khẩu, chưa publish
- [x] Bão: khi navy.mil chặn máy chủ, nhờ trợ lý PC 5.6 tải hộ RSS/KMZ JTWC rồi mới rơi xuống JMA; badge V 2.23, chưa publish
- [x] Bão: vẽ kiểu Google Earth JTWC (vòng gió hồng mờ, vùng nguy hiểm viền đỏ, biểu tượng xoáy đỏ, nhãn "giờ - knots"), V 2.24, chưa publish
- [x] KHB: đưa cột PCR T/O lên trước, cột RMK xuống cuối (bảng tool + trang KHB), badge V 2.94, 18 kiểm thử đạt, build OK, chưa publish
- [x] Verify tam giác đỏ: bỏ nút ✔ ở bảng hiển thị, đưa về cột VERIFY của tab Dữ liệu so sánh (bấm là verify, xong lên xanh), badge V 3.19, chưa publish
- [x] Briefing: 4 dòng LOW EGT, bỏ tiền tố FM: ở defect
- [x] Compare: cột TAF + EXTRA sau STD; Validation -2cm, Note -1cm
