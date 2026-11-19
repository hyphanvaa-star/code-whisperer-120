export const REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "😡"] as const;
export const STICKER_IDS = ["panda", "plane", "cat", "penguin"] as const;
export type StickerId = (typeof STICKER_IDS)[number];
export type Reaction = { message_id: string; user_id: string; emoji: string };

export function stickerBody(id: StickerId) {
  return `[sohee-sticker:${id}]`;
}
export function readSticker(body: string): StickerId | null {
  return STICKER_IDS.find((id) => stickerBody(id) === body) ?? null;
}
export function groupReactions(rows: Reaction[], messageId: string, me: string) {
  return REACTIONS.map((emoji) => {
    const matches = rows.filter((r) => r.message_id === messageId && r.emoji === emoji);
    return { emoji, count: matches.length, mine: matches.some((r) => r.user_id === me) };
  }).filter((r) => r.count > 0);
}
export function insertEmoji(text: string, emoji: string, start: number, end = start) {
  return { text: text.slice(0, start) + emoji + text.slice(end), caret: start + emoji.length };
}

// Preserve complete emoji sequences (skin tones, flags, keycaps and ZWJ families).
const emojiPattern =
  /(?:\p{Regional_Indicator}{2}|[0-9#*]\uFE0F?\u20E3|\p{Extended_Pictographic}[\uFE0F\p{Emoji_Modifier}]*(?:\u200D\p{Extended_Pictographic}[\uFE0F\p{Emoji_Modifier}]*)*)/gu;
export function messageParts(body: string) {
  return body
    .split(new RegExp(`(${emojiPattern.source})`, "gu"))
    .filter(Boolean)
    .map((text) => ({
      text,
      emoji: new RegExp(`^(?:${emojiPattern.source})$`, "u").test(text),
    }));
}
export function isEmojiOnly(body: string) {
  const parts = messageParts(body);
  return parts.some((part) => part.emoji) && parts.every((part) => part.emoji || !part.text.trim());
}

export type ChatFile = { path: string; name: string; size: number; type: string };
const FILE_PREFIX = "[sohee-file:";
export function fileBody(f: ChatFile) {
  return FILE_PREFIX + JSON.stringify(f) + "]";
}
export function readFile(body: string): ChatFile | null {
  if (!body.startsWith(FILE_PREFIX) || !body.endsWith("]")) return null;
  try {
    const f = JSON.parse(body.slice(FILE_PREFIX.length, -1));
    return typeof f?.path === "string" && typeof f?.name === "string" ? f : null;
  } catch {
    return null;
  }
}
export function fileSize(n: number) {
  return n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1048576).toFixed(1)} MB`;
}
export const CHAT_FILE_MAX = 20 * 1024 * 1024;

export type FileKind = "image" | "pdf" | "sheet" | "doc" | "slide" | "archive" | "text" | "other";
const KIND_EXT: Record<Exclude<FileKind, "image" | "other">, string[]> = {
  pdf: ["pdf"],
  sheet: ["xls", "xlsx", "xlsm", "csv", "ods"],
  doc: ["doc", "docx", "odt", "rtf"],
  slide: ["ppt", "pptx", "odp"],
  archive: ["zip", "rar", "7z", "gz", "tar"],
  text: ["txt", "log", "json", "xml", "md"],
};
export function fileExt(name: string) {
  const m = /\.([a-z0-9]{1,5})$/i.exec(name.trim());
  return m ? m[1].toUpperCase() : "FILE";
}
/** Loại tệp để chọn biểu tượng/màu thẻ đính kèm. */
export function fileKind(name: string, type = ""): FileKind {
  if (type.startsWith("image/")) return "image";
  const ext = fileExt(name).toLowerCase();
  for (const [kind, list] of Object.entries(KIND_EXT)) if (list.includes(ext)) return kind as FileKind;
  if (type === "application/pdf") return "pdf";
  return "other";
}

// Đếm tin chưa đọc cho mọi phòng từ MỘT lượt đọc (thay vì mỗi phòng một yêu cầu).
// Chỉ tính tin của người khác, mới hơn mốc "đã đọc" riêng của từng phòng.
export function countUnread(
  rows: { room_id: string; user_id: string; created_at: string }[],
  sinceByRoom: Record<string, string>,
  me: string,
) {
  const out: Record<string, number> = {};
  for (const id of Object.keys(sinceByRoom)) out[id] = 0;
  for (const r of rows) {
    const since = sinceByRoom[r.room_id];
    if (since === undefined || r.user_id === me) continue;
    if (Date.parse(r.created_at) > Date.parse(since)) out[r.room_id] += 1;
  }
  return out;
}
