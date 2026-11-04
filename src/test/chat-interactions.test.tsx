import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatWidget } from '@/components/chat/ChatWidget';

const store = vi.hoisted(() => ({
  messages: [{ id: 'message1', room_id: 'room1', user_id: 'other', body: 'Đã rõ', created_at: '2026-11-04T04:00:00Z' }],
  reactions: [{ message_id: 'message1', user_id: 'other', emoji: '👍' }],
  writes: [] as { table: string; operation: string; payload: Record<string, string> }[],
  readAvatars: async () => ({}),
}));
vi.mock('@tanstack/react-start', () => ({ useServerFn: () => store.readAvatars }));
vi.mock('@/lib/account.functions', () => ({ getChatAvatars: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: (table: string) => {
  let operation = 'read';
  let payload: Record<string, string> = {};
  const filters: Record<string, string> = {};
  const query = {
    select: () => query, order: () => query, limit: () => query, in: () => query,
    neq: () => query, gt: () => query,
    eq: (key: string, value: string) => { filters[key] = value; return query; },
    insert: (value: Record<string, string>) => { operation = 'insert'; payload = value; return query; },
    upsert: (value: Record<string, string>) => { operation = 'upsert'; payload = value; return query; },
    delete: () => { operation = 'delete'; return query; },
    then: (resolve: (result: unknown) => unknown) => {
      if (operation !== 'read') {
        store.writes.push({ table, operation, payload: operation === 'delete' ? filters : payload });
        if (table === 'chat_reactions' && operation === 'upsert') store.reactions.push(payload as typeof store.reactions[number]);
        if (table === 'chat_reactions' && operation === 'delete') store.reactions = store.reactions.filter((r) => !(r.message_id === filters.message_id && r.user_id === filters.user_id && r.emoji === filters.emoji));
        if (table === 'chat_messages' && operation === 'insert') store.messages.push({ ...payload, id: 'message2', created_at: '2026-11-04T04:01:00Z' } as typeof store.messages[number]);
      }
      const data = table === 'chat_rooms' ? [{ id: 'room1', kind: 'group', name: 'Phòng chung', dm_key: null }]
        : table === 'chat_messages' ? [...store.messages]
        : table === 'chat_reactions' ? [...store.reactions] : [];
      return Promise.resolve({ data, error: null, count: 0 }).then(resolve);
    },
  };
  return query;
} } }));

beforeEach(() => {
  store.messages = [{ id: 'message1', room_id: 'room1', user_id: 'other', body: 'Đã rõ', created_at: '2026-11-04T04:00:00Z' }];
  store.reactions = [{ message_id: 'message1', user_id: 'other', emoji: '👍' }];
  store.writes = [];
});
afterEach(cleanup);
async function openRoom() {
  render(<ChatWidget userId="me" />);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Chat nội bộ' })); });
  fireEvent.click(await screen.findByRole('button', { name: /Phòng chung/ }));
  await screen.findByText('Đã rõ');
}
describe('Chat actions', () => {
  it('persists then retracts only the current user reaction', async () => {
    await openRoom();
    fireEvent.click(await screen.findByRole('button', { name: 'Thả 👍, 1 lượt' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Thu hồi 👍, 2 lượt' }));
    await screen.findByRole('button', { name: 'Thả 👍, 1 lượt' });
    expect(store.reactions).toEqual([{ message_id: 'message1', user_id: 'other', emoji: '👍' }]);
    expect(store.writes).toEqual([
      { table: 'chat_reactions', operation: 'upsert', payload: { message_id: 'message1', user_id: 'me', emoji: '👍' } },
      { table: 'chat_reactions', operation: 'delete', payload: { message_id: 'message1', user_id: 'me', emoji: '👍' } },
    ]);
  });
  it('sends a selected sticker to the active room and reads it back as an image', async () => {
    await openRoom();
    fireEvent.click(screen.getByRole('button', { name: 'Nhãn dán' }));
    fireEvent.click(screen.getByRole('button', { name: 'Gửi nhãn dán Máy bay yêu thương' }));
    await waitFor(() => expect(store.writes).toContainEqual({ table: 'chat_messages', operation: 'insert', payload: { room_id: 'room1', user_id: 'me', body: '[sohee-sticker:plane]' } }));
    await screen.findByRole('img', { name: 'Máy bay yêu thương' });
    expect(screen.queryByText('[sohee-sticker:plane]')).toBeNull();
  });
});