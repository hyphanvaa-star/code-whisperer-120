import { describe, expect, it } from "vitest";
import {
  countUnread,
  groupReactions,
  insertEmoji,
  readSticker,
  stickerBody,
  messageParts,
  isEmojiOnly,
} from "@/components/chat/chat-content";

describe("Chat content", () => {
  it("keeps complex emoji intact and preserves surrounding message text", () => {
    expect(messageParts("Rõ 👍🏽 👨‍👩‍👧‍👦 🇻🇳 1️⃣")).toEqual([
      { text: "Rõ ", emoji: false },
      { text: "👍🏽", emoji: true },
      { text: " ", emoji: false },
      { text: "👨‍👩‍👧‍👦", emoji: true },
      { text: " ", emoji: false },
      { text: "🇻🇳", emoji: true },
      { text: " ", emoji: false },
      { text: "1️⃣", emoji: true },
    ]);
    expect(isEmojiOnly("😅 😅")).toBe(true);
    expect(isEmojiOnly("Đã rõ 👍")).toBe(false);
    expect(isEmojiOnly("123")).toBe(false);
    expect(isEmojiOnly("")).toBe(false);
  });
  it("recognizes only complete allowlisted sticker messages", () => {
    expect(readSticker(stickerBody("plane"))).toBe("plane");
    expect(readSticker("[sohee-sticker:https://other.site/a.jpg]")).toBeNull();
    expect(readSticker("hello [sohee-sticker:plane]")).toBeNull();
  });
  it("counts shared reactions and identifies only the current user reaction", () => {
    expect(
      groupReactions(
        [
          { message_id: "m1", user_id: "me", emoji: "👍" },
          { message_id: "m1", user_id: "other", emoji: "👍" },
          { message_id: "m2", user_id: "me", emoji: "❤️" },
        ],
        "m1",
        "me",
      ),
    ).toEqual([{ emoji: "👍", count: 2, mine: true }]);
  });
  it("removing own reaction preserves the other person reaction", () => {
    const rows = [
      { message_id: "m1", user_id: "me", emoji: "👍" },
      { message_id: "m1", user_id: "other", emoji: "👍" },
    ];
    expect(
      groupReactions(
        rows.filter((r) => r.user_id !== "me"),
        "m1",
        "me",
      ),
    ).toEqual([{ emoji: "👍", count: 1, mine: false }]);
  });
  it("inserts emoji at the caret without losing the rest of the message", () => {
    expect(insertEmoji("Ca trực", "✈️", 3)).toEqual({ text: "Ca ✈️trực", caret: 5 });
    expect(insertEmoji("Ca trực", "👍", 3, 7)).toEqual({ text: "Ca 👍", caret: 5 });
  });
});

import { fileKind, fileExt } from '@/components/chat/chat-content';
describe('chat file kind', () => {
  it('maps attachment extensions to their card type', () => {
    expect(fileKind('OFP.pdf')).toBe('pdf');
    expect(fileKind('crewlist.XLSX')).toBe('sheet');
    expect(fileKind('memo.docx')).toBe('doc');
    expect(fileKind('pack.zip')).toBe('archive');
    expect(fileKind('a.png', 'image/png')).toBe('image');
    expect(fileKind('noext')).toBe('other');
    expect(fileExt('crewlist.xlsx')).toBe('XLSX');
  });
});

describe("countUnread", () => {
  it("counts only other users' messages newer than each room's read mark", () => {
    const rows = [
      { room_id: "a", user_id: "u2", created_at: "2026-11-19T06:00:00Z" },
      { room_id: "a", user_id: "u2", created_at: "2026-11-19T07:00:00Z" },
      { room_id: "a", user_id: "me", created_at: "2026-11-19T07:05:00Z" },
      { room_id: "b", user_id: "u3", created_at: "2026-11-19T05:00:00Z" },
      { room_id: "x", user_id: "u3", created_at: "2026-11-19T09:00:00Z" },
    ];
    const since = { a: "2026-11-19T06:30:00Z", b: "2026-11-19T04:00:00Z", c: "2026-11-19T00:00:00Z" };
    expect(countUnread(rows, since, "me")).toEqual({ a: 1, b: 1, c: 0 });
  });
  it("treats Postgres-style timestamps the same as ISO marks", () => {
    const rows = [{ room_id: "a", user_id: "u2", created_at: "2026-11-19T06:40:42.209044+00:00" }];
    expect(countUnread(rows, { a: "2026-11-19T06:40:42.000Z" }, "me")).toEqual({ a: 1 });
    expect(countUnread(rows, { a: "2026-11-19T06:41:00.000Z" }, "me")).toEqual({ a: 0 });
  });
});
