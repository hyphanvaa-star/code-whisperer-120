# Cách web lọc NOTAM (chế độ "Lọc notam tracking chuyến")

Đây là bảng giải thích, chưa phải việc cần sửa. Bấm Approve nếu không cần đổi gì; nếu muốn chỉnh luật nào, nhắn cho mình.

## 1. Lấy NOTAM ở đâu
- Nơi lấy: sân đi, sân đến, sân dự bị cất cánh, sân dự bị đến, sân dự bị dọc đường (nếu OFP ghi) và mọi FIR mà route bay qua.
- Chỉ giữ NOTAM còn hiệu lực trong 24 giờ, giống mục 24H trên FliteBrief.
- Nếu NOTAM nhắc tên vùng (AIP SUP, vùng cấm/nguy hiểm), web tự tra ranh giới vùng đó trong AIP để vẽ lên bản đồ.

## 2. Mỗi NOTAM đi qua 4 bước kiểm tra
1. **Đọc được không**: thiếu mục Q/A/B/C/E hoặc không đọc được thì xếp NEED MANUAL CHECK.
2. **Giờ hiệu lực có trùng giờ chuyến không** (giờ B–C so với khung giờ của từng loại nơi):

| Nơi | Khung giờ xét |
|---|---|
| Sân đi | ETD −60 đến +60 phút |
| Sân đến | ETA −60 đến +60 phút |
| Dự bị cất cánh | ETD −15 đến +60 phút |
| Dự bị dọc đường | ETD đến ETA +60 phút |
| Dự bị đến | ETA −60 đến +60 phút |
| FIR | giờ vào FIR −60 đến giờ ra FIR +60 phút |

   - Có tính thêm khả năng chậm tới 180 phút. Nếu chỉ trùng giờ khi chuyến bị chậm thì xếp DELAY-ONLY.
   - Có xét lịch hoạt động ở mục D (ví dụ chỉ bật vài giờ trong ngày, hoặc giờ mặt trời mọc/lặn).
   - Các mốc giờ này chỉnh được trong nút Filter setting.
3. **Vị trí có dính chuyến không**, xét lần lượt theo thứ tự sau:
   - Bỏ qua NOTAM chỉ dành cho trực thăng hoặc tàu bay VFR.
   - NOTAM trỏ sang AIP SUP/AMDT, hoặc đổi minima tại sân của chuyến: cần kiểm tra tay.
   - NOTAM nhắc SID/STAR/phương thức tiếp cận: chỉ tính khi đúng tên phương thức trong FPL.
   - Đường băng, đường lăn, sân đỗ, cứu hỏa (so với cấp cứu hỏa loại tàu cần), đài dẫn đường, liên lạc, radio check, chim, đèn: chỉ tính khi là sân của chuyến; nếu không đóng đường băng thì xếp BRIEFING INFO.
   - Vùng có hình (đa giác, vòng tròn, đường): đo khoảng cách tới route, nằm trong hành lang (mặc định 5 NM) mới tính. Chướng ngại vật/UAV không có chữ cấm thì chỉ là briefing.
4. **Độ cao**: so dải độ cao của NOTAM với FL chuyến bay tại điểm giao. Chuyến bay cao hơn hoặc thấp hơn dải thì xếp MINOR. Ví dụ A2095/26: NOTAM có hiệu lực tới FL200, chuyến bay FL320, nên xếp MINOR.

## 3. Kết quả: 5 mức, gom thành 4 nhóm trên web

| Mức chi tiết | Nhóm trên web |
|---|---|
| CRITICAL: dính đúng giờ kế hoạch | CRUCIAL |
| DELAY-ONLY: chỉ dính nếu chuyến chậm | CRUCIAL |
| NEED MANUAL CHECK: thiếu dữ liệu, không kết luận được | MANUAL CHECK |
| BRIEFING INFO: liên quan nhưng không cấm/đóng | BRIEFING INFO |
| NO IMPACT: không dính giờ, vị trí hoặc độ cao | MINOR |

- Nguyên tắc an toàn: chỉ bỏ ra khi chắc chắn không dính; còn nghi ngờ thì đưa vào MANUAL CHECK. NOTAM loại CRUCIAL hoặc MANUAL CHECK không bao giờ bị ẩn.
- Trên bản đồ: mặc định hiện mọi vùng; ô "Ẩn vùng không ảnh hưởng" sẽ ẩn các vùng MINOR.

## 4. Kiểm tra thêm sau khi lọc
- **So với Briefing pack**: chỉ so ở những sân và FIR mà cả web và pack đều có. Pack có NOTAM mà web không có thì báo "Thiếu N" màu đỏ.
- **Quét lại 1 giờ trước giờ bay**: đến mốc này web tự lấy lại NOTAM, có NOTAM mới thì báo "+N mới". Không có thì hiện "✓ Không NOTAM mới".

## 5. Giới hạn hiện tại
- Một số luật vẫn dựa vào chữ trong mục E, nên NOTAM viết lạ có thể rơi vào MANUAL CHECK.
- Với VJ5288, web không lấy các sân dự bị dọc đường và FIR RCAA mà Briefing pack có. Lượt so với pack bỏ qua những chỗ đó.
