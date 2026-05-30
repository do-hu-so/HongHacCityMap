# Hướng dẫn Cập nhật Bản đồ (KML → GeoJSON)

Tài liệu này hướng dẫn bạn cách lấy dữ liệu mới nhất từ **Google My Maps** để cập nhật bản đồ trong dự án Next.js mà vẫn giữ nguyên các chỉnh sửa trước đó (tiêu đề, mô tả, hình ảnh, đường nối, text label).

---

## 📌 Quy trình 4 Bước Cập nhật Bản đồ

### Bước 1: Tải KML từ Google My Maps
1. Truy cập vào bản đồ của bạn trên [Google My Maps](https://www.google.com/maps/d/).
2. Nhấn vào biểu tượng **dấu 3 chấm** ở ngay bên cạnh tên bản đồ (bên trái màn hình).
3. Chọn **Export to KML/KMZ** (Xuất ra KML/KMZ).
4. Thực hiện tích chọn chính xác như sau:
   - **Tích chọn**: `Export as KML instead of KMZ` (Xuất dưới dạng KML thay vì KMZ).
   - **KHÔNG TÍCH CHỌN**: `Keep data updated with a network link...` (Giữ dữ liệu được cập nhật bằng liên kết mạng...).
5. Nhấn **Download** (Tải xuống).

> [!IMPORTANT]
> Nếu bạn tích chọn "Keep data updated with a network link...", file tải xuống sẽ chỉ nặng ~400 bytes và không chứa dữ liệu thực tế, gây lỗi khi convert.

---

### Bước 2: Thay thế file KML trong dự án
1. Copy file KML vừa tải xuống.
2. Dán đè (ghi đè) vào vị trí sau trong thư mục dự án:
   `g:\HONGHAC\map\new_project\map\HongHacCiTY.kml`

---

### Bước 3: Chạy lệnh Convert để đồng bộ hóa
1. Mở cửa sổ dòng lệnh (Terminal/Command Prompt/PowerShell) tại thư mục dự án `g:\HONGHAC\map\new_project`.
2. Chạy lệnh sau:
   ```bash
   npm run convert
   ```
3. Script sẽ tự động:
   - Tạo bản backup an toàn của dữ liệu cũ trong `public/data/backup/`.
   - Chuyển đổi file KML mới sang GeoJSON.
   - So khớp tọa độ để tự động giữ lại thông tin chỉnh sửa (tiêu đề, ảnh, mô tả...) từ overlays cũ.
   - In ra báo cáo tổng kết số lượng đối tượng được cập nhật.

---

### Bước 4: Khởi chạy dự án để xem kết quả
1. Chạy lệnh start/dev server (nếu chưa chạy):
   ```bash
   npm run dev
   ```
2. Mở trình duyệt truy cập vào địa chỉ mặc định `http://localhost:3000`.
3. Kiểm tra xem các thay đổi mới trên Google My Maps đã hiển thị trên bản đồ chưa và các text label/hình ảnh tự thêm vẫn hiển thị đúng vị trí.
