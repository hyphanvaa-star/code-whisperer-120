// Trạng thái online: có tín hiệu trong 2 phút gần nhất là Live.
export const LIVE_MS = 2 * 60_000;

export function presence(lastSeen: string | null, now = Date.now()): { live: boolean; text: string } {
  if (!lastSeen) return { live: false, text: "Offline" };
  const d = now - new Date(lastSeen).getTime();
  if (d < LIVE_MS) return { live: true, text: "Live" };
  const m = Math.floor(d / 60_000);
  if (m < 60) return { live: false, text: `Offline ${m} phút` };
  const h = Math.floor(m / 60);
  if (h < 24) return { live: false, text: `Offline ${h} giờ` };
  return { live: false, text: `Offline ${Math.floor(h / 24)} ngày` };
}
