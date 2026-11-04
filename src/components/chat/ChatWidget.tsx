import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getChatAvatars } from "@/lib/account.functions";
import { supabase } from "@/integrations/supabase/client";
import { MessageCircle, X, Trash2, ArrowLeft, Send, Users, Smile, Sticker } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChatPicker, STICKERS } from "./ChatPicker";
import {
  REACTIONS,
  groupReactions,
  insertEmoji,
  messageParts,
  isEmojiOnly,
  readSticker,
  stickerBody,
  type Reaction,
  type StickerId,
} from "./chat-content";

type Room = { id: string; kind: string; name: string; dm_key: string | null };
type Msg = { id: string; room_id: string; user_id: string; body: string; created_at: string };
type Profile = { id: string; email: string | null; display_name: string | null; last_seen_at?: string | null };
// Online = heartbeat (every 40s while the tool tab is open) within the last 2 minutes.
const isOnline = (p: Profile) => !!p.last_seen_at && Date.now() - new Date(p.last_seen_at).getTime() < 120_000;

const GROUP_NAME = "Phòng chung";

let audioCtx: AudioContext | null = null;
/** Tiếng "ting" hai nốt kiểu Messenger */
function playMessengerPing() {
  try {
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    audioCtx = audioCtx || new AC();
    const ctx = audioCtx;
    if (ctx.state === "suspended") void ctx.resume();
    const t0 = ctx.currentTime;
    [
      [880, 0],
      [1320, 0.11],
    ].forEach(([f, d]) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.setValueAtTime(f, t0 + d);
      g.gain.setValueAtTime(0.0001, t0 + d);
      g.gain.exponentialRampToValueAtTime(1, t0 + d + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + d + 0.22);
      o.connect(g).connect(ctx.destination);
      o.start(t0 + d);
      o.stop(t0 + d + 0.25);
    });
    navigator.vibrate?.([120, 60, 120]);
  } catch {
    /* trình duyệt chặn âm thanh */
  }
}

function nameOf(p: Profile | undefined, fallback: string) {
  return (p?.display_name || p?.email || fallback).toString();
}

/** Avatar vuông bo góc kiểu WeChat, màu theo tên */
function Avatar({
  label,
  seed,
  size = 38,
  src,
}: {
  label: string;
  seed: string;
  size?: number;
  src?: string;
}) {
  const [failedSrc, setFailedSrc] = useState("");
  if (src && src !== failedSrc)
    return (
      <img
        src={src}
        alt={label}
        width={size}
        height={size}
        className="shrink-0 rounded-full object-cover"
        onError={() => setFailedSrc(src)}
      />
    );
  const tones = ["var(--chat-avatar-a)", "var(--chat-avatar-b)", "var(--chat-avatar-c)"];
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const tone = tones[h % tones.length];
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-full text-sm font-bold text-[var(--chat-accent-ink)]"
      style={{
        width: size,
        height: size,
        background: tone,
      }}
    >
      {label.slice(0, 1).toUpperCase()}
    </span>
  );
}

export function ChatWidget({ userId: me }: { userId: string | null }) {
  const [isAdmin, setIsAdmin] = useState(false);
  const [open, setOpen] = useState(false);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [avatars, setAvatars] = useState<Record<string, string>>({});
  const readAvatars = useServerFn(getChatAvatars);
  const [active, setActive] = useState<Room | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [picker, setPicker] = useState<"emoji" | "stickers" | null>(null);
  const [reactionMenu, setReactionMenu] = useState<string | null>(null);
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const [reactionBusy, setReactionBusy] = useState(false);
  const [chatError, setChatError] = useState("");
  const activeRoomRef = useRef<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!me) return;
    let alive = true;
    void supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", me)
      .then(({ data: roles }) => {
        if (alive) setIsAdmin(!!roles?.some((r) => r.role === "admin"));
      });
    return () => {
      alive = false;
    };
  }, [me]);

  const loadRooms = useCallback(async () => {
    const { data, error } = await supabase
      .from("chat_rooms")
      .select("id,kind,name,dm_key")
      .order("created_at");
    if (error || !data) return rooms;
    let list = data as Room[];
    if (!list.some((r) => r.kind === "group")) {
      await supabase.from("chat_rooms").insert({ kind: "group", name: GROUP_NAME });
      const again = await supabase
        .from("chat_rooms")
        .select("id,kind,name,dm_key")
        .order("created_at");
      list = (again.data as Room[] | null) ?? [];
    }
    const firstGroup = list.find((r) => r.kind === "group");
    list = list.filter((r) => r.kind !== "group" || r === firstGroup);
    setRooms(list);
    return list;
  }, []);

  const loadProfiles = useCallback(async () => {
    const { data } = await supabase.from("profiles").select("id,email,display_name,last_seen_at");
    setProfiles((data as Profile[] | null) ?? []);
    try {
      setAvatars(await readAvatars());
    } catch {
      /* Keep initials when unavailable. */
    }
  }, [readAvatars]);

  useEffect(() => {
    if (!me || !open) return;
    loadRooms();
    loadProfiles();
  }, [me, open, loadRooms, loadProfiles]);

  useEffect(() => {
    if (!me || !open) return;
    const refresh = () => {
      void loadProfiles();
    };
    window.addEventListener("sohee-profile-updated", refresh);
    const timer = setInterval(refresh, 30_000);
    return () => {
      clearInterval(timer);
      window.removeEventListener("sohee-profile-updated", refresh);
    };
  }, [me, open, loadProfiles]);

  const loadMessages = useCallback(async (roomId: string) => {
    const { data, error } = await supabase
      .from("chat_messages")
      .select("id,room_id,user_id,body,created_at")
      .eq("room_id", roomId)
      .order("created_at", { ascending: true })
      .limit(200);
    if (activeRoomRef.current !== roomId || error) return;
    const nextMessages = (data as Msg[] | null) ?? [];
    setMessages(nextMessages);
    if (!nextMessages.length) {
      setReactions([]);
      return;
    }
    const result = await supabase
      .from("chat_reactions")
      .select("message_id,user_id,emoji")
      .in(
        "message_id",
        nextMessages.map((m) => m.id),
      );
    if (activeRoomRef.current === roomId && !result.error) setReactions(result.data ?? []);
  }, []);

  useEffect(() => {
    activeRoomRef.current = active?.id ?? null;
    setMessages([]);
    setReactions([]);
    setPicker(null);
    setReactionMenu(null);
    setChatError("");
    if (!active) return;
    loadMessages(active.id);
    const t = setInterval(() => loadMessages(active.id), 4000);
    return () => clearInterval(t);
  }, [active, loadMessages]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages.length, active?.id]);

  useEffect(() => {
    if (active) inputRef.current?.focus();
  }, [active]);

  // ---- Tin chưa đọc (badge kiểu Messenger) ----
  const [unread, setUnread] = useState<Record<string, number>>({});
  const readKey = (roomId: string) => `chat.read.${me}.${roomId}`;
  const markRead = useCallback(
    (roomId: string) => {
      if (!me) return;
      localStorage.setItem(`chat.read.${me}.${roomId}`, new Date().toISOString());
      setUnread((u) => (u[roomId] ? { ...u, [roomId]: 0 } : u));
    },
    [me],
  );

  useEffect(() => {
    if (!me) return;
    let alive = true;
    const tick = async () => {
      const list = await loadRooms();
      if (!alive) return;
      const next: Record<string, number> = {};
      await Promise.all(
        list.map(async (r) => {
          const key = `chat.read.${me}.${r.id}`;
          let since = localStorage.getItem(key);
          if (!since) {
            since = new Date().toISOString();
            localStorage.setItem(key, since);
          }
          const { count } = await supabase
            .from("chat_messages")
            .select("id", { count: "exact", head: true })
            .eq("room_id", r.id)
            .neq("user_id", me)
            .gt("created_at", since);
          next[r.id] = count ?? 0;
        }),
      );
      if (alive) setUnread(next);
    };
    void tick();
    void loadProfiles();
    const t = setInterval(tick, 6000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [me, loadRooms, loadProfiles]);

  useEffect(() => {
    if (active && open) markRead(active.id);
  }, [active, open, messages.length, markRead]);

  const totalUnread = Object.entries(unread).reduce(
    (s, [id, n]) => (active && open && id === active.id ? s : s + n),
    0,
  );
  const prevUnread = useRef(0);
  useEffect(() => {
    if (totalUnread > prevUnread.current) playMessengerPing();
    prevUnread.current = totalUnread;
  }, [totalUnread]);

  if (!me) return null;
  void readKey;
  const badge = (n: number, cls = "") =>
    n > 0 ? (
      <span
        className={`flex min-w-5 h-5 items-center justify-center rounded-full border-2 border-[var(--chat-panel)] bg-[var(--chat-danger)] px-1 text-[11px] font-bold leading-none text-[var(--chat-accent-ink)] ${cls}`}
      >
        {n > 9 ? "9+" : n}
      </span>
    ) : null;

  const profileOf = (id: string) => profiles.find((p) => p.id === id);
  const dmPartner = (r: Room) => {
    const ids = (r.dm_key || "").split("|").filter(Boolean);
    return profileOf(ids.find((i) => i !== me) || "");
  };
  const roomLabel = (r: Room) =>
    r.kind === "group" ? r.name || GROUP_NAME : nameOf(dmPartner(r), "Chat riêng");

  const openDm = async (otherId: string) => {
    const key = [me, otherId].sort().join("|");
    let room = rooms.find((r) => r.dm_key === key);
    if (!room) {
      const { data } = await supabase
        .from("chat_rooms")
        .insert({ kind: "dm", name: "", dm_key: key })
        .select("id,kind,name,dm_key")
        .single();
      if (data) room = data as Room;
      else {
        const again = await supabase
          .from("chat_rooms")
          .select("id,kind,name,dm_key")
          .eq("dm_key", key)
          .single();
        if (again.data) room = again.data as Room;
      }
      if (room) {
        const addedRoom = room;
        setRooms((prev) => [...prev, addedRoom]);
      }
    }
    if (room) setActive(room);
  };

  const send = async (sticker?: StickerId) => {
    const body = sticker ? stickerBody(sticker) : draft.trim();
    if (!body || !active || sending) return;
    const roomId = active.id;
    setSending(true);
    setChatError("");
    try {
      const { error } = await supabase
        .from("chat_messages")
        .insert({ room_id: roomId, user_id: me, body });
      if (error) throw error;
      if (activeRoomRef.current === roomId) {
        if (!sticker) setDraft("");
        setPicker(null);
        await loadMessages(roomId);
        inputRef.current?.focus();
      }
    } catch {
      setChatError("Chưa gửi được tin nhắn. Vui lòng thử lại.");
    } finally {
      setSending(false);
    }
  };

  const toggleReaction = async (messageId: string, emoji: string) => {
    if (!active || reactionBusy) return;
    const roomId = active.id;
    const exists = reactions.some(
      (r) => r.message_id === messageId && r.user_id === me && r.emoji === emoji,
    );
    setReactionBusy(true);
    setChatError("");
    try {
      const result = exists
        ? await supabase
            .from("chat_reactions")
            .delete()
            .eq("message_id", messageId)
            .eq("user_id", me)
            .eq("emoji", emoji)
        : await supabase
            .from("chat_reactions")
            .upsert(
              { message_id: messageId, user_id: me, emoji },
              { onConflict: "message_id,user_id,emoji", ignoreDuplicates: true },
            );
      if (result.error) throw result.error;
      if (activeRoomRef.current === roomId) {
        setReactionMenu(null);
        await loadMessages(roomId);
      }
    } catch {
      setChatError("Chưa lưu được cảm xúc. Vui lòng thử lại.");
    } finally {
      setReactionBusy(false);
    }
  };

  const addEmoji = (emoji: string) => {
    const input = inputRef.current;
    const next = insertEmoji(
      draft,
      emoji,
      input?.selectionStart ?? draft.length,
      input?.selectionEnd ?? draft.length,
    );
    setDraft(next.text);
    requestAnimationFrame(() => {
      input?.focus();
      input?.setSelectionRange(next.caret, next.caret);
    });
  };

  const remove = async (id: string) => {
    if (!isAdmin || !active) return;
    await supabase.from("chat_messages").delete().eq("id", id);
    loadMessages(active.id);
  };

  const fmt = (iso: string) =>
    new Date(iso).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });

  return (
    <>
      <style>{`@keyframes chatShake{0%,60%,100%{transform:rotate(0)}65%{transform:rotate(-14deg)}70%{transform:rotate(12deg)}75%{transform:rotate(-10deg)}80%{transform:rotate(8deg)}85%{transform:rotate(-4deg)}90%{transform:rotate(0)}}`}</style>
      <Button
        variant="ghost"
        aria-label="Chat nội bộ"
        onClick={() => setOpen((v) => !v)}
        style={
          totalUnread > 0 && !open
            ? { animation: "chatShake 1.6s ease-in-out infinite" }
            : undefined
        }
        className="fixed bottom-5 right-5 z-50 flex h-13 w-13 items-center justify-center rounded-full bg-[var(--chat-accent)] p-3.5 text-[var(--chat-accent-ink)] shadow-[var(--chat-launcher-shadow)] transition-transform hover:scale-105 active:scale-95"
      >
        {open ? <X className="h-6 w-6" /> : <MessageCircle className="h-6 w-6" />}
        {badge(totalUnread, "absolute -right-1 -top-1 animate-[bounce_1s_ease-in-out_2]")}
      </Button>

      {open && (
        <div className="chat-window fixed bottom-20 right-5 z-50 flex h-[min(680px,calc(100dvh-110px))] w-[460px] max-w-[calc(100vw-2.5rem)] flex-col overflow-hidden rounded-2xl border border-[var(--chat-line)] bg-[var(--chat-panel)] text-[var(--chat-ink)] shadow-[var(--chat-window-shadow)]">
          {!active ? (
            <>
              <div className="flex items-center gap-3 border-b border-[var(--chat-line)] bg-[var(--chat-header)] px-5 py-5">
                <MessageCircle className="h-6 w-6 text-[var(--chat-accent)]" />
                <span className="text-lg font-semibold text-[var(--chat-header-ink)]">
                  Chat nội bộ
                </span>
              </div>
              <div className="flex-1 overflow-y-auto bg-[var(--chat-panel)]">
                {rooms
                  .filter((r) => r.kind === "group")
                  .map((r) => (
                    <Button
                      variant="ghost"
                      key={r.id}
                      onClick={() => setActive(r)}
                      className="flex h-auto w-full justify-start items-center gap-3 border-b border-[var(--chat-line)] px-5 py-4 text-left transition-colors hover:bg-[var(--chat-hover)]"
                    >
                      <span className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full bg-[var(--chat-accent)] text-[var(--chat-accent-ink)]">
                        <Users className="h-5 w-5" />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-base font-semibold text-[var(--chat-ink)]">
                          {roomLabel(r)}
                        </span>
                        <span className="block text-xs text-[var(--chat-sub)]">
                          Tất cả dispatcher
                        </span>
                      </span>
                      {badge(unread[r.id] ?? 0, "ml-auto")}
                    </Button>
                  ))}
                <div className="bg-[var(--chat-bg)] px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--chat-sub)]">
                  Chat riêng
                </div>
                {profiles
                  .filter((p) => p.id !== me)
                  .map((p) => (
                    <Button
                      variant="ghost"
                      key={p.id}
                      onClick={() => openDm(p.id)}
                      className="flex h-auto w-full justify-start items-center gap-3 border-b border-[var(--chat-line)] px-5 py-4 text-left transition-colors hover:bg-[var(--chat-hover)]"
                    >
                      <span className="relative shrink-0">
                        <Avatar label={nameOf(p, "?")} seed={p.id} src={avatars[p.id]} />
                        {isOnline(p) && (
                          <span aria-hidden className="absolute bottom-0 right-0 h-3.5 w-3.5 rounded-full border-2 border-[var(--chat-bg)] bg-[#16a34a]" />
                        )}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-base font-semibold text-[var(--chat-ink)]">
                          {nameOf(p, p.id)}
                        </span>
                        {isOnline(p) ? (
                          <span className="flex items-center gap-1.5 text-xs font-semibold text-[#16a34a]">
                            <span className="h-2 w-2 rounded-full bg-[#16a34a]" />
                            Đang online
                          </span>
                        ) : (
                          <span className="block text-xs text-[var(--chat-sub)]">Nhắn riêng</span>
                        )}
                      </span>
                      {badge(
                        unread[
                          rooms.find((r) => r.dm_key === [me, p.id].sort().join("|"))?.id ?? ""
                        ] ?? 0,
                        "ml-auto",
                      )}
                    </Button>
                  ))}
              </div>
            </>
          ) : (
            <>
              <div className="flex shrink-0 items-center gap-3 border-b border-[var(--chat-line)] bg-[var(--chat-header)] px-3 py-4">
                <Button
                  variant="ghost"
                  aria-label="Quay lại"
                  onClick={() => setActive(null)}
                  title="Quay lại"
                  className="h-9 w-9 shrink-0 rounded-full p-0 text-[var(--chat-accent)] transition-colors hover:bg-[var(--chat-hover)]"
                >
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                {active.kind === "group" ? (
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--chat-accent)] text-[var(--chat-accent-ink)]">
                    <Users className="h-4 w-4" />
                  </span>
                ) : (
                  <Avatar
                    label={roomLabel(active)}
                    seed={active.id}
                    size={40}
                    src={avatars[dmPartner(active)?.id || ""]}
                  />
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-base font-semibold text-[var(--chat-header-ink)]">
                    {roomLabel(active)}
                  </div>
                  <div className="mt-0.5 text-xs text-[var(--chat-sub)]">
                    {active.kind === "group" ? "Sohee · Dispatch team" : "Tin nhắn riêng"}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Đóng chat"
                  title="Đóng chat"
                  onClick={() => setOpen(false)}
                  className="h-9 w-9 shrink-0 rounded-full text-[var(--chat-sub)]"
                >
                  <X className="h-5 w-5" />
                </Button>
              </div>
              <div
                ref={listRef}
                className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain bg-[var(--chat-bg)] p-4"
              >
                {messages.length === 0 && (
                  <div className="pt-12 text-center text-xs text-[var(--chat-sub)]">
                    Chưa có tin nhắn. Gửi tin đầu tiên nhé.
                  </div>
                )}
                {messages.map((m) => {
                  const mine = m.user_id === me;
                  const sender = profileOf(m.user_id);
                  const sticker = readSticker(m.body);
                  const emojiOnly = !sticker && isEmojiOnly(m.body);
                  const messageReactions = groupReactions(reactions, m.id, me);
                  return (
                    <div
                      key={m.id}
                      className={`group flex items-start gap-2 ${mine ? "flex-row-reverse" : ""}`}
                    >
                      <Avatar
                        label={nameOf(sender, "?")}
                        seed={m.user_id}
                        size={32}
                        src={avatars[m.user_id]}
                      />
                      <div
                        className={`flex min-w-0 max-w-[80%] flex-col ${mine ? "items-end" : "items-start"}`}
                      >
                        {!mine && active.kind === "group" && (
                          <div className="mb-1 px-2 text-xs text-[var(--chat-sub)]">
                            {nameOf(sender, "—")}
                          </div>
                        )}
                        <div
                          className={`relative ${sticker || emojiOnly ? "px-1 py-1 text-[var(--chat-ink)]" : `rounded-2xl px-4 py-2.5 text-base leading-relaxed ${mine ? "bg-[var(--chat-bubble-me)] text-[var(--chat-bubble-me-ink)]" : "bg-[var(--chat-bubble-other)] text-[var(--chat-ink)]"}`}`}
                        >
                          {sticker ? (
                            <img
                              src={STICKERS[sticker].src}
                              alt={STICKERS[sticker].name}
                              width={512}
                              height={512}
                              loading="lazy"
                              className="h-40 w-40 max-w-full object-contain"
                            />
                          ) : (
                            <div
                              className={`whitespace-pre-wrap break-words [overflow-wrap:anywhere] ${emojiOnly ? "chat-emoji-only" : "chat-message-text"}`}
                            >
                              {messageParts(m.body).map((part, index) =>
                                part.emoji ? (
                                  <span key={index} className="chat-emoji">
                                    {part.text}
                                  </span>
                                ) : (
                                  part.text
                                ),
                              )}
                            </div>
                          )}
                          <div
                            className={`mt-1 flex items-center gap-1.5 text-[11px] ${
                              mine && !sticker && !emojiOnly
                                ? "justify-end text-[var(--chat-bubble-me-ink)]/75"
                                : "text-[var(--chat-sub)]"
                            }`}
                          >
                            {fmt(m.created_at)}
                            {isAdmin && (
                              <Button
                                variant="ghost"
                                aria-label="Xóa tin nhắn"
                                onClick={() => remove(m.id)}
                                className="h-6 w-6 p-0 text-[var(--chat-danger)] opacity-70 sm:opacity-0 sm:group-hover:opacity-100"
                              >
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            )}
                          </div>
                        </div>
                        <div className="mt-1 flex max-w-full flex-wrap items-center gap-1">
                          {messageReactions.map((r) => (
                            <Button
                              key={r.emoji}
                              variant="ghost"
                              disabled={reactionBusy}
                              aria-label={`${r.mine ? "Thu hồi" : "Thả"} ${r.emoji}, ${r.count} lượt`}
                              aria-pressed={r.mine}
                              title={reactions
                                .filter((v) => v.message_id === m.id && v.emoji === r.emoji)
                                .map((v) => nameOf(profileOf(v.user_id), "Dispatcher"))
                                .join(", ")}
                              onClick={() => void toggleReaction(m.id, r.emoji)}
                              className={`h-7 gap-1 rounded-full border px-2 text-xs ${r.mine ? "border-[var(--chat-accent)] bg-[var(--chat-bubble-me)] text-[var(--chat-bubble-me-ink)]" : "border-[var(--chat-line)] bg-[var(--chat-panel)] text-[var(--chat-ink)]"}`}
                            >
                              <span className="text-lg leading-none">{r.emoji}</span>
                              {r.count}
                            </Button>
                          ))}
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Thả cảm xúc"
                            aria-label={`Thả cảm xúc tin ${m.id}`}
                            aria-expanded={reactionMenu === m.id}
                            onClick={() => setReactionMenu(reactionMenu === m.id ? null : m.id)}
                            className="h-7 w-7 text-[var(--chat-sub)] hover:bg-[var(--chat-hover)]"
                          >
                            <Smile />
                          </Button>
                        </div>
                        {reactionMenu === m.id && (
                          <div
                            className="mt-1 flex flex-wrap gap-0.5 rounded-lg border border-[var(--chat-line)] bg-[var(--chat-panel)] p-1"
                            role="group"
                            aria-label="Cảm xúc tin nhắn"
                          >
                            {REACTIONS.map((emoji) => (
                              <Button
                                key={emoji}
                                variant="ghost"
                                disabled={reactionBusy}
                                title={emoji}
                                aria-label={`Thả ${emoji}`}
                                onClick={() => void toggleReaction(m.id, emoji)}
                                className="h-8 w-8 p-0 text-xl hover:bg-[var(--chat-hover)]"
                              >
                                {emoji}
                              </Button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              {chatError && (
                <div role="alert" className="px-3 py-1 text-xs text-[var(--chat-danger)]">
                  {chatError}
                </div>
              )}
              {picker && (
                <ChatPicker
                  mode={picker}
                  busy={sending}
                  onEmoji={addEmoji}
                  onSticker={(id) => void send(id)}
                />
              )}
              <div className="flex shrink-0 items-center gap-1.5 border-t border-[var(--chat-line)] bg-[var(--chat-panel)] px-3 py-3">
                <Button
                  variant="ghost"
                  size="icon"
                  title="Emoji"
                  aria-label="Emoji"
                  aria-expanded={picker === "emoji"}
                  onClick={() => setPicker(picker === "emoji" ? null : "emoji")}
                  className="h-10 w-10 shrink-0 rounded-full text-[var(--chat-accent)] hover:bg-[var(--chat-hover)]"
                >
                  <Smile />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  title="Nhãn dán"
                  aria-label="Nhãn dán"
                  aria-expanded={picker === "stickers"}
                  onClick={() => setPicker(picker === "stickers" ? null : "stickers")}
                  className="h-10 w-10 shrink-0 rounded-full text-[var(--chat-accent)] hover:bg-[var(--chat-hover)]"
                >
                  <Sticker />
                </Button>
                <input
                  ref={inputRef}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.nativeEvent.isComposing) void send();
                  }}
                  placeholder="Nhập tin nhắn…"
                  className="h-11 min-w-0 flex-1 rounded-full border border-transparent bg-[var(--chat-bubble-other)] px-4 text-base text-[var(--chat-ink)] outline-none transition-shadow focus:border-[var(--chat-accent)] focus:ring-2 focus:ring-[var(--chat-accent)]/25"
                />
                <Button
                  aria-label="Gửi"
                  onClick={() => void send()}
                  disabled={sending || !draft.trim()}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--chat-accent)] p-0 text-[var(--chat-accent-ink)] transition-colors hover:brightness-95 disabled:opacity-40"
                >
                  <Send className="h-5 w-5" />
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}
