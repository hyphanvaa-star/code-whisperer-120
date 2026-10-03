import { supabase } from "@/integrations/supabase/client";

export async function fetchFbFile(
  params: { sector: number; att?: number; kind: "att" | "ofp" },
  signal?: AbortSignal,
): Promise<Blob> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Phiên đăng nhập đã hết, đăng nhập lại");
  const q = new URLSearchParams({ sector: String(params.sector), kind: params.kind });
  if (params.att) q.set("att", String(params.att));
  const res = await fetch(`/api/fb/file?${q}`, { headers: { Authorization: `Bearer ${token}` }, signal: signal ?? null });
  if (!res.ok) throw new Error(res.status === 404 ? "Chưa có file" : `Lỗi ${res.status}`);
  return res.blob();
}

export function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function openBlob(blob: Blob) {
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank", "noopener");
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export const safeName = (s: string) => s.replace(/[\\/:*?"<>|]+/g, "_").trim() || "file";
