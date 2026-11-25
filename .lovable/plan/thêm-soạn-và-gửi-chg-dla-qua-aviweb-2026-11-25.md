# Thêm soạn và gửi CHG/DLA qua AviWeb

## Kết quả anh sẽ có

Trong **Flight Planning → Tạo điện văn**, thêm hai lựa chọn **DLA AviWeb** và **CHG AviWeb**. Anh tick chuyến, sửa điện bằng các ô rõ ràng, xem lại nội dung rồi bấm **Xác nhận gửi AviWeb**; Trợ lý PC thực hiện gửi bằng mã anh cung cấp.

Giữ nguyên các lựa chọn soạn/xuất điện hiện tại và đường gửi FPL. Không tự gửi khi phát hiện chuyến thay đổi.

## Những điểm đã kiểm tra

- Bảng soạn điện hiện tại có DLA và nhiều loại CHG, sửa bằng ô văn bản; nút gửi đang bị ẩn khi mở loại điện này.
- Trợ lý PC hiện có gửi FPL và kiểm tra AviWeb, chưa có lệnh gửi CHG/DLA theo bộ mã đính kèm.
- `HUONG-DAN.txt` yêu cầu trình chỉnh riêng cho CHG/DLA, không đổi cách bấm gửi, không bịa cách gửi field 15/16 và **không gửi thử lên AviWeb**.
- Mã gửi đính kèm tìm dòng Processed theo callsign. Chỉ kiểm tra callsign chưa đủ bảo đảm đúng ngày/chặng; luồng mới phải chặn khi không xác minh được đúng chuyến.

## 1. Chọn chuyến và lấy nguồn đúng

- Chỉ lấy những chuyến đã tick, giữ nguyên danh sách qua bước chỉnh và xác nhận; không tự thêm các chuyến còn lại trên bảng.
- Đọc FPL hiện hành từ OFP FliteBrief của đúng chuyến/ngày/chặng trong khung **−6/+24 giờ**, sử dụng cách chọn và đọc OFP hiện có.
- Giờ khởi tạo lấy **ETD hiện tại**, thiếu ETD mới dùng **STD**, chuyển đúng sang **UTC HHMM**. Giữ đủ ngày khi chuyển qua nửa đêm.
- CHG lấy field **9, 10, 18** từ FPL hiện hành; `REG/` phải khớp đăng ký Crewlist/DayRep đúng chuyến. Thiếu nguồn, sai ngày hoặc sai tàu thì báo rõ và không dựng điện để gửi.
- Hiện nguồn OFP/CFP, chuyến, chặng, DOF và tàu ngay trong bảng kiểm tra. Nếu một chuyến không đủ dữ liệu, không âm thầm bỏ nó khỏi lượt gửi; anh chọn lại danh sách hợp lệ trước khi xác nhận.

## 2. Bảng chỉnh điện rõ ràng

### DLA AviWeb

- Chỉ sửa **EOBT UTC**, đúng 4 số và trong khoảng `0000–2359`.
- **Callsign, sân đi, sân đến, DOF** khóa theo chuyến đã chọn.
- Dựng lại đúng dạng:

```text
(DLA-CALLSIGN-DEPHHMM-DEST-DOF/YYMMDD)
```

### CHG AviWeb

- Có ô **EOBT UTC**, **loại máy bay**, **wake**, **equipment**, **surveillance**.
- Field 18 trình bày thành từng dòng **mã / giá trị**; được sửa, thêm hoặc xóa token hợp lệ, giữ nguyên giá trị có khoảng trắng.
- **DOF không được sửa hoặc xóa**; callsign và sân đi/đến cũng khóa. `REG/` sau sửa vẫn phải khớp tàu Crewlist/DayRep.
- Header và field 13 cùng dùng EOBT đã xác nhận, đúng cách dựng của `aviweb_legacy_package` trong file anh gửi, không dùng bộ dựng điện khác để thay thế.
- Điện CHG chỉ có field **9, 10, 13, 18**. Không nhận field 15/16, CNL hoặc FPL trong đường gửi mới.

### Cách trình bày

- Danh sách chuyến bên cạnh, các ô chỉnh có nhãn rõ ràng, bản điện hoàn chỉnh cập nhật theo nội dung nhập.
- Chuyển chuyến không mất phần đã sửa; có **Copy**, **Xuất TXT**, **Xem lại** và **Xác nhận gửi AviWeb**.
- Bảng sáng, chữ dễ đọc, phân biệt thông tin khóa và ô được sửa; tận dụng phong cách hiện tại, phù hợp cả màn hình nhỏ.
- Bấm ra ngoài không đóng bảng đang nhập; chỉ **✕ hoặc Esc**. Khi đang gửi, đóng bảng không được coi là đã hủy lệnh.

## 3. Xác nhận và gửi bằng Trợ lý PC

- Tạo bản soạn có `plan_id`, gắn tài khoản và danh tính từng chuyến; bước thực thi nhận `plan_id`, `confirmed=true` và **nội dung cuối cùng đã xác nhận**.
- Kiểm tra lại phía máy chủ: loại điện, cấu trúc, số lượng và danh sách callsign, ngày/chặng, giờ, field được phép và REG. Không chỉ dựa vào các ô khóa trên màn hình.
- Bản soạn có thời hạn; trước khi giao gửi phải đọc lại chuyến hiện hành. Nếu dữ liệu liên quan đã đổi, yêu cầu lập lại và xác nhận lại, không tự sửa điện đã duyệt.
- Dùng khóa thực thi theo `plan_id` để bấm hai lần, mở nhiều tab hoặc nối lại kết nối không tạo lệnh gửi trùng. Hiển thị lại lệnh cũ thay vì tự gửi lại.
- Gửi trên **đúng máy Trợ lý PC đã ghép với tài khoản**, dùng tài khoản AviWeb đã lưu trên web; không đưa mật khẩu vào trang, bản soạn hoặc log.
- Tích hợp `AviWebSender` vào Trợ lý PC qua lớp nối riêng; **giữ selector gửi, addressee `VVTSVJCX` / `KHOUXAAF` và logic Submit của mã đính kèm**.
- Bổ sung bước kiểm tra danh tính trước thao tác gửi, tận dụng phần đọc AviWeb hiện có. Dòng Processed phải xác minh duy nhất đúng callsign/DOF/chặng; nếu không đọc được hoặc có nhiều dòng không phân biệt được, **không Submit**. Không lấy kết quả check cũ làm bằng chứng cho dòng đang được chọn.
- DLA dùng **Processed → Delay**; CHG dùng **Processed → Change**. Không đi qua chức năng gửi FPL, không tự convert lại nội dung đã duyệt.
- Chỉ ghi **Đã gửi** khi mã gửi trả bằng chứng xác nhận từ AviWeb. Một điện lỗi hoặc không rõ đã nhận hay chưa thì dừng phần còn lại, giữ kết quả riêng **đã gửi / lỗi hoặc chưa xác nhận / chưa gửi**; không tự thử lại.
- Giữ nút **Check ATC avi** chạy khi người trực bấm; không khôi phục tự check EOBT nền. Kiểm tra an toàn gắn với lần xác nhận gửi, không chạy khi chỉ mở bảng.

## 4. Kiểm thử và bàn giao

- Kiểm thử dựng và chỉnh điện nhiều chuyến; HHMM sai, thiếu ETD, giờ qua nửa đêm, sai DOF/chặng/REG, thiếu nguồn và chuyến ngoài −6/+24.
- Kiểm thử token field 18 có khoảng trắng, DOF bị sửa/xóa, field 15/16, sai loại điện, thêm/bớt/trùng callsign và nội dung không thuộc bản soạn.
- Kiểm thử bản soạn thuộc tài khoản khác, hết hạn, nguồn thay đổi và xác nhận lặp; bảo đảm mỗi bản soạn chỉ giao gửi một lần.
- Giả lập AviWeb và Trợ lý PC để kiểm tra đúng nhánh Delay/Change, addressee, xác nhận Submit, dừng batch khi lỗi và không tự gửi lại.
- Kiểm tra thao tác trên web: tick chuyến → mở bảng → sửa từng chuyến → xem lại → xác nhận với kênh gửi giả lập → đọc lại kết quả; kiểm tra màn hình lớn và nhỏ.
- **Không gửi điện thử lên AviWeb thật**, đúng hướng dẫn anh gửi. Bàn giao sẽ ghi rõ phần gửi thật chưa được kiểm chứng trực tiếp.
- Tăng bản web từ **V 7.62 → V 7.63**, Trợ lý PC từ **6.18 → 6.19**, đóng gói để cập nhật theo cách hiện tại. Không tự publish trong yêu cầu này.

## Chi tiết kỹ thuật

- Phần parse/serialize/validation CHG-DLA tách thành module thuần trong `src/lib/tool/port/`, có kiểm thử cạnh các bài ATC hiện có.
- Bảng chỉnh được nạp qua `src/routes/tool-page.ts`; không sửa trực tiếp `src/tool/page.html`. Đường gửi mới dùng handler xác thực của công cụ, tách khỏi `/api/atc/submit` đang gửi FPL.
- Bản soạn và dấu thực thi lưu bền phía máy chủ, bảo vệ theo chủ tài khoản; không dùng biến dùng chung trong bộ nhớ. Giữ ranh giới chỉ Dispatcher được đọc/chỉnh/gửi dữ liệu chuyến.
- Thêm loại lệnh PC riêng cho CHG/DLA trong `pcagent.server.ts` và `pc-agent/pc_agent.py`; các module Python phụ thuộc trong mã trích được tách/nối để nạp độc lập, không cần cài ứng dụng Dispatch Tool bên ngoài.
- Không đưa credential vào source, không sao chép tùy chọn bỏ qua kiểm tra chứng chỉ HTTPS từ mã đính kèm. Không thay đổi FPL, CNL, CHG ROUTE/ALT hiện tại hoặc logic ACK của các bảng khác.