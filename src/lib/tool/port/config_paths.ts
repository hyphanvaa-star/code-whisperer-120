// Port of config.paths_status() defaults — web (no local D:\ drive in a Worker).
export function pathsStatus() {
  return {
    available: false,
    note: "Chạy trên web: không có ổ D:\\ cục bộ — các thư mục lưu trong kho dữ liệu của ứng dụng.",
    paths: {},
  };
}
