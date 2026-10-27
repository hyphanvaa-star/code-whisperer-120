// Nguồn thay đổi của một ô trên bảng KHB: chỉ FPL VER, chỉ Crewlist mới,
// hoặc cả hai cùng đổi. Khi FliteBrief đã cập nhật đúng giá trị mới thì ô
// chuyển sang trạng thái "ok" (xanh lá) bất kể nguồn.
export type ChangeSource = "fpl" | "crew" | "both";
export type ChangeTone = "fpl" | "crew" | "both" | "ok";

export function changeTone(src: ChangeSource | null | undefined, fbOk: boolean): ChangeTone | null {
  if (!src) return null;
  return fbOk ? "ok" : src;
}

/** Gộp nguồn: thêm FPL vào ô đã có dấu Crewlist (hoặc ngược lại) thành "both". */
export function mergeChangeSource(a: ChangeSource | null | undefined, b: ChangeSource | null | undefined): ChangeSource | null {
  if (!a) return b ?? null;
  if (!b) return a;
  return a === b ? a : "both";
}
