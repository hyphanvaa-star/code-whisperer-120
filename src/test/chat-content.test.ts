import { describe, expect, it } from 'vitest';
import { groupReactions, insertEmoji, readSticker, stickerBody } from '@/components/chat/chat-content';

describe('Chat content', () => {
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