import { describe, expect, it } from 'vitest';
import { groupReactions, insertEmoji, readSticker, stickerBody, messageParts, isEmojiOnly } from '@/components/chat/chat-content';

describe('Chat content', () => {
  it('keeps complex emoji intact and preserves surrounding message text', () => {
    expect(messageParts('Rõ 👍🏽 👨‍👩‍👧‍👦 🇻🇳 1️⃣')).toEqual([
      { text: 'Rõ ', emoji: false }, { text: '👍🏽', emoji: true },
      { text: ' ', emoji: false }, { text: '👨‍👩‍👧‍👦', emoji: true },
      { text: ' ', emoji: false }, { text: '🇻🇳', emoji: true },
      { text: ' ', emoji: false }, { text: '1️⃣', emoji: true },
    ]);
    expect(isEmojiOnly('😅 😅')).toBe(true);
    expect(isEmojiOnly('Đã rõ 👍')).toBe(false);
    expect(isEmojiOnly('123')).toBe(false);
    expect(isEmojiOnly('')).toBe(false);
  });
  it('recognizes only complete allowlisted sticker messages', () => {
    expect(readSticker(stickerBody('plane'))).toBe('plane');
    expect(readSticker('[sohee-sticker:https://other.site/a.jpg]')).toBeNull();
    expect(readSticker('hello [sohee-sticker:plane]')).toBeNull();
  });
  it('counts shared reactions and identifies only the current user reaction', () => {
    expect(groupReactions([
      { message_id: 'm1', user_id: 'me', emoji: '👍' },
      { message_id: 'm1', user_id: 'other', emoji: '👍' },
      { message_id: 'm2', user_id: 'me', emoji: '❤️' },
    ], 'm1', 'me')).toEqual([{ emoji: '👍', count: 2, mine: true }]);
  });
  it('removing own reaction preserves the other person reaction', () => {
    const rows = [{ message_id: 'm1', user_id: 'me', emoji: '👍' }, { message_id: 'm1', user_id: 'other', emoji: '👍' }];
    expect(groupReactions(rows.filter((r) => r.user_id !== 'me'), 'm1', 'me')).toEqual([{ emoji: '👍', count: 1, mine: false }]);
  });
  it('inserts emoji at the caret without losing the rest of the message', () => {
    expect(insertEmoji('Ca trực', '✈️', 3)).toEqual({ text: 'Ca ✈️trực', caret: 5 });
    expect(insertEmoji('Ca trực', '👍', 3, 7)).toEqual({ text: 'Ca 👍', caret: 5 });
  });
});