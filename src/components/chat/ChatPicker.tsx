import { useState } from 'react';
import { Button } from '@/components/ui/button';
import panda from '@/assets/chat-sticker-panda.jpg';
import plane from '@/assets/chat-sticker-plane.jpg';
import cat from '@/assets/chat-sticker-cat.jpg';
import penguin from '@/assets/chat-sticker-penguin.jpg';
import { STICKER_IDS, type StickerId } from './chat-content';

export const STICKERS: Record<StickerId, { src: string; name: string }> = {
  panda: { src: panda, name: 'Gấu trúc chào' },
  plane: { src: plane, name: 'Máy bay yêu thương' },
  cat: { src: cat, name: 'Mèo trực ca' },
  penguin: { src: penguin, name: 'Đã rõ' },
};
const EMOJI_GROUPS = [
  { name: 'Cảm xúc', icon: '😀', values: '😀 😃 😄 😁 😆 😅 😂 🤣 😊 😇 🙂 🙃 😉 😌 😍 🥰 😘 😋 😛 😜 🤪 🤨 🧐 🤓 😎 🤩 🥳 😏 😒 😞 😔 😟 😕 🙁 😣 😖 😫 😩 🥺 😢 😭 😤 😠 😡 🤯 😳 🥵 🥶 😱 😨 😰 😥 😓 🤗 🤔 🫡 🤭 🤫 😶 😐 😑 🙄 😮 😲 🥱 😴 🤤 😪 😵 🤐 🥴 🤢 🤮 🤧 😷 🤒 🤕' },
  { name: 'Cử chỉ', icon: '👍', values: '👍 👎 👌 🤌 🤏 ✌️ 🤞 🫰 🤟 🤘 🤙 👈 👉 👆 👇 ☝️ ✋ 🤚 🖐️ 🖖 👋 🤝 🙌 👏 🫶 🙏 💪 ✍️ 👀 🧠 ❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💔 ❤️‍🔥 💕 💞 💓 💗 💖 💘 💝 💯 ✅ ❌ ⚠️ 🆗' },
  { name: 'Hàng không', icon: '✈️', values: '✈️ 🛫 🛬 🛩️ 🚁 🛰️ 🚀 🧑‍✈️ 👨‍✈️ 👩‍✈️ 🌍 🌏 🧭 🗺️ 📍 🕐 ⏱️ ⏰ 📅 ⛽ 🧳 🎫 🛂 🛃 🛅 🚨 📡 📋 📝 📎 📞 💻 🖨️ ☀️ 🌤️ ⛅ 🌥️ ☁️ 🌦️ 🌧️ ⛈️ 🌩️ ❄️ 🌪️ 🌬️ 🌈' },
  { name: 'Đời sống', icon: '🐼', values: '🐼 🐱 🐶 🐧 🐻 🐰 🦊 🦁 🐯 🐨 🦄 🐸 🐵 🐥 🌸 🌺 🌻 🌹 🍀 🌴 🌲 ⭐ 🌟 ✨ 🔥 🎉 🎊 🎈 🎁 🏆 🥇 🎯 🎵 🎶 ☕ 🍵 🧋 🥤 🍻 🍕 🍔 🍟 🍜 🍚 🍎 🍓 🍒 🍉 🍌 🍰 🍫' },
];

export function ChatPicker({ mode, busy, onEmoji, onSticker }: { mode: 'emoji' | 'stickers'; busy: boolean; onEmoji: (emoji: string) => void; onSticker: (id: StickerId) => void }) {
  const [category, setCategory] = useState(0);
  const group = EMOJI_GROUPS[category] ?? EMOJI_GROUPS[0];
  return <div className="border-t border-[var(--chat-line)] bg-[var(--chat-panel)] text-[var(--chat-ink)]">
    {mode === 'emoji' ? <>
      <div className="flex items-center gap-1 border-b border-[var(--chat-line)] px-2 py-1">
        {EMOJI_GROUPS.map((g, i) => <Button key={g.name} variant="ghost" size="icon" title={g.name} aria-label={g.name} aria-pressed={category === i} onClick={() => setCategory(i)} className={category === i ? 'bg-[var(--chat-hover)] text-xl' : 'text-xl'}>{g.icon}</Button>)}
        <span className="ml-auto text-xs text-[var(--chat-sub)]">{group.name}</span>
      </div>
      <div className="grid max-h-40 grid-cols-8 gap-1 overflow-y-auto p-2">
        {group.values.split(' ').map((emoji) => <Button variant="ghost" size="icon" key={emoji} aria-label={`Chèn ${emoji}`} onClick={() => onEmoji(emoji)} className="h-9 w-full p-0 text-2xl hover:bg-[var(--chat-hover)]">{emoji}</Button>)}
      </div>
    </> : <div className="grid grid-cols-4 gap-2 p-2">
      {STICKER_IDS.map((id) => <Button variant="ghost" key={id} disabled={busy} title={STICKERS[id].name} aria-label={`Gửi nhãn dán ${STICKERS[id].name}`} onClick={() => onSticker(id)} className="h-auto min-w-0 p-0 hover:bg-[var(--chat-hover)]"><img src={STICKERS[id].src} alt={STICKERS[id].name} width={512} height={512} loading="lazy" className="aspect-square w-full rounded-md object-contain" /></Button>)}
    </div>}
  </div>;
}