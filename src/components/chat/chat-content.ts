export const REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '😡'] as const;
export const STICKER_IDS = ['panda', 'plane', 'cat', 'penguin'] as const;
export type StickerId = typeof STICKER_IDS[number];
export type Reaction = { message_id: string; user_id: string; emoji: string };

export function stickerBody(id: StickerId) { return `[sohee-sticker:${id}]`; }
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