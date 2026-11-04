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
