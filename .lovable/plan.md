# Header: chừa chỗ cho email, chữ to hơn, hạ thanh lọc

## Thay đổi
1. **Hai vạch chéo vàng/trắng dời sang phải**: nới vùng đỏ bên trái (đang rộng max(15.2%, 390px)) lên khoảng 470px. Như vậy cả hai email `hyphanthanh@vietjetair.com · huydoan@vietjetair.com` nằm gọn trên nền đỏ, không chạm vạch.
2. **Chữ khu thương hiệu to hơn**:
   - "A product design by Hy & Huy": 10.5px → 12.5px
   - Dòng Contact: 10.5px → 12.5px, nhãn CONTACT 8.5px → 10px, biểu tượng thư 14px → 16px
3. **Thanh lọc DSP / Callsign / DEP / DEST / REG / Khung giờ hạ xuống một chút**, khoảng 10px, để không đè lên dòng email đã to hơn. Hàng nút Refresh/TAF bên phải giữ nguyên vị trí.
4. Nâng phiên bản lên **V 7.26**.

## Kiểm tra
Chụp màn hình phần đầu trang ở khổ 1280px để xác nhận email nằm gọn trong vùng đỏ, chữ dễ đọc hơn và thanh lọc không bị đè.

## Chi tiết kỹ thuật
Chỉ sửa CSS trong lớp sửa trang (`src/routes/tool-page.ts`): `header#mdRoom::before` (độ rộng/điểm chia gradient), `.ops-brand-credit`, `.ops-brand-contact` (+ small/svg), và `header#mdRoom .md-stage` top (58% → khoảng 62%). Không đổi logic.
