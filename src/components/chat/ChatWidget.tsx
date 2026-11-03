import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getChatAvatars } from "@/lib/account.functions";
import { supabase } from "@/integrations/supabase/client";
import { MessageCircle, X, Trash2, ArrowLeft, Send, Users } from "lucide-react";

type Room = { id: string; kind: string; name: string; dm_key: string | null };
type Msg = { id: string; room_id: string; user_id: string; body: string; created_at: string };
type Profile = { id: string; email: string | null; display_name: string | null };

const GROUP_NAME = "Phòng chung";

let audioCtx: AudioContext | null = null;
/** Tiếng "ting" hai nốt kiểu Messenger */
function playMessengerPing() {
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    audioCtx = audioCtx || new AC();
    const ctx = audioCtx;
    if (ctx.state === "suspended") void ctx.resume();
    const t0 = ctx.currentTime;
    [[880, 0], [1320, 0.11]].forEach(([f, d]) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.setValueAtTime(f, t0 + d);
      g.gain.setValueAtTime(0.0001, t0 + d);
      g.gain.exponentialRampToValueAtTime(0.35, t0 + d + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + d + 0.22);
      o.connect(g).connect(ctx.destination);
      o.start(t0 + d);
      o.stop(t0 + d + 0.25);
    });
    navigator.vibrate?.([120, 60, 120]);
  } catch { /* trình duyệt chặn âm thanh */ }
}

function nameOf(p: Profile | undefined, fallback: string) {
  return (p?.display_name || p?.email || fallback).toString();
}

/** Avatar vuông bo góc kiểu WeChat, màu theo tên */
function Avatar({ label, seed, size = 38, src }: { label: string; seed: string; size?: number; src?: string }) {
  const [failedSrc, setFailedSrc] = useState("");
  if (src && src !== failedSrc) return <img src={src} alt={label} width={size} height={size} className="shrink-0 rounded-md object-cover" onError={() => setFailedSrc(src)} />;
  const hues = [150, 20, 210, 260, 330, 45, 190, 100];
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const hue = hues[h % hues.length];
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-[6px] text-sm font-bold text-white"
      style={{
        width: size,
        height: size,
        background: `linear-gradient(135deg, oklch(0.62 0.14 ${hue}), oklch(0.5 0.15 ${hue + 25}))`,
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
    const { data, error } = await supabase.from("chat_rooms").select("id,kind,name,dm_key").order("created_at");
    if (error || !data) return rooms;
    let list = data as Room[];
    if (!list.some((r) => r.kind === "group")) {
      await supabase.from("chat_rooms").insert({ kind: "group", name: GROUP_NAME });
      const again = await supabase.from("chat_rooms").select("id,kind,name,dm_key").order("created_at");
      list = (again.data as Room[] | null) ?? [];
    }
    const firstGroup = list.find((r) => r.kind === "group");
    list = list.filter((r) => r.kind !== "group" || r === firstGroup);
    setRooms(list);
    return list;
  }, []);

  const loadProfiles = useCallback(async () => {
    const { data } = await supabase.from("profiles").select("id,email,display_name");
    setProfiles((data as Profile[] | null) ?? []);
    try { setAvatars(await readAvatars()); } catch { /* Keep initials when unavailable. */ }
  }, [readAvatars]);

  useEffect(() => {
    if (!me || !open) return;
    loadRooms();
    loadProfiles();
  }, [me, open, loadRooms, loadProfiles]);

  useEffect(() => {
    if (!me || !open) return;
    const refresh = () => { void loadProfiles(); };
    window.addEventListener("sohee-profile-updated", refresh);
    const timer = setInterval(refresh, 60_000);
    return () => { clearInterval(timer); window.removeEventListener("sohee-profile-updated", refresh); };
  }, [me, open, loadProfiles]);

  const loadMessages = useCallback(async (roomId: string) => {
    const { data } = await supabase
      .from("chat_messages")
      .select("id,room_id,user_id,body,created_at")
      .eq("room_id", roomId)
      .order("created_at", { ascending: true })
      .limit(200);
    setMessages((data as Msg[] | null) ?? []);
  }, []);

  useEffect(() => {
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
  const markRead = useCallback((roomId: string) => {
    if (!me) return;
    localStorage.setItem(`chat.read.${me}.${roomId}`, new Date().toISOString());
    setUnread((u) => (u[roomId] ? { ...u, [roomId]: 0 } : u));
  }, [me]);

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
    return () => { alive = false; clearInterval(t); };
  }, [me, loadRooms, loadProfiles]);

  useEffect(() => {
    if (active && open) markRead(active.id);
  }, [active, open, messages.length, markRead]);

  const totalUnread = Object.entries(unread).reduce((s, [id, n]) => (active && open && id === active.id ? s : s + n), 0);
  const prevUnread = useRef(0);
  useEffect(() => {
    if (totalUnread > prevUnread.current) playMessengerPing();
    prevUnread.current = totalUnread;
  }, [totalUnread]);

  if (!me) return null;
  void readKey;
  const badge = (n: number, cls = "") =>
    n > 0 ? (
      <span className={`flex min-w-5 h-5 items-center justify-center rounded-full border-2 border-[var(--chat-panel)] bg-[var(--chat-danger)] px-1 text-[11px] font-bold leading-none text-white ${cls}`}>
        {n > 9 ? "9+" : n}
      </span>
    ) : null;

  const profileOf = (id: string) => profiles.find((p) => p.id === id);
  const dmPartner = (r: Room) => {
    const ids = (r.dm_key || "").split("|").filter(Boolean);
    return profileOf(ids.find((i) => i !== me) || "");
  };
  const roomLabel = (r: Room) => (r.kind === "group" ? r.name || GROUP_NAME : nameOf(dmPartner(r), "Chat riêng"));

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
        const again = await supabase.from("chat_rooms").select("id,kind,name,dm_key").eq("dm_key", key).single();
        if (again.data) room = again.data as Room;
      }
      if (room) {
        const addedRoom = room;
        setRooms((prev) => [...prev, addedRoom]);
      }
    }
    if (room) setActive(room);
  };

  const send = async () => {
    const body = draft.trim();
    if (!body || !active || sending) return;
    setSending(true);
    const { error } = await supabase
      .from("chat_messages")
      .insert({ room_id: active.id, user_id: me, body });
    setSending(false);
    if (!error) {
      setDraft("");
      loadMessages(active.id);
      inputRef.current?.focus();
    }
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
      <button
        aria-label="Chat nội bộ"
        onClick={() => setOpen((v) => !v)}
        style={totalUnread > 0 && !open ? { animation: "chatShake 1.6s ease-in-out infinite" } : undefined}
        className="fixed bottom-5 right-5 z-50 flex h-13 w-13 items-center justify-center rounded-full bg-[var(--chat-accent)] p-3.5 text-[var(--chat-accent-ink)] shadow-[0_6px_20px_-4px_oklch(0.66_0.19_150/0.6)] transition-transform hover:scale-105 active:scale-95"
      >
        {open ? <X className="h-6 w-6" /> : <MessageCircle className="h-6 w-6" />}
        {badge(totalUnread, "absolute -right-1 -top-1 animate-[bounce_1s_ease-in-out_2]")}
      </button>

      {open && (
        <div className="fixed bottom-20 right-5 z-50 flex h-[520px] w-[380px] max-w-[calc(100vw-2.5rem)] flex-col overflow-hidden rounded-2xl border border-[var(--chat-line)] bg-[var(--chat-panel)] shadow-2xl">
          {!active ? (
            <>
              <div className="flex items-center gap-2 bg-[var(--chat-header)] px-4 py-3.5">
                <MessageCircle className="h-4 w-4 text-[var(--chat-accent)]" />
                <span className="text-sm font-semibold tracking-wide text-[var(--chat-header-ink)]">
                  Chat nội bộ
                </span>
              </div>
              <div className="flex-1 overflow-y-auto bg-[var(--chat-panel)]">
                {rooms
                  .filter((r) => r.kind === "group")
                  .map((r) => (
                    <button
                      key={r.id}
                      onClick={() => setActive(r)}
                      className="flex w-full items-center gap-3 border-b border-[var(--chat-line)] px-4 py-3 text-left transition-colors hover:bg-[var(--chat-hover)]"
                    >
                      <span className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[6px] bg-[var(--chat-accent)] text-[var(--chat-accent-ink)]">
                        <Users className="h-5 w-5" />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-[var(--chat-ink)]">
                          {roomLabel(r)}
                        </span>
                        <span className="block text-xs text-[var(--chat-sub)]">Tất cả dispatcher</span>
                      </span>
                      {badge(unread[r.id] ?? 0, "ml-auto")}
                    </button>
                  ))}
                <div className="bg-[var(--chat-bg)] px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--chat-sub)]">
                  Chat riêng
                </div>
                {profiles
                  .filter((p) => p.id !== me)
                  .map((p) => (
                    <button
                      key={p.id}
                      onClick={() => openDm(p.id)}
                      className="flex w-full items-center gap-3 border-b border-[var(--chat-line)] px-4 py-3 text-left transition-colors hover:bg-[var(--chat-hover)]"
                    >
                      <Avatar label={nameOf(p, "?")} seed={p.id} src={avatars[p.id]} />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-[var(--chat-ink)]">
                          {nameOf(p, p.id)}
                        </span>
                        <span className="block text-xs text-[var(--chat-sub)]">Nhắn riêng</span>
                      </span>
                      {badge(unread[rooms.find((r) => r.dm_key === [me, p.id].sort().join("|"))?.id ?? ""] ?? 0, "ml-auto")}
                    </button>
                  ))}
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2 bg-[var(--chat-header)] px-3 py-2.5">
                <button
                  aria-label="Quay lại"
                  onClick={() => setActive(null)}
                  className="rounded-md p-1.5 text-[var(--chat-header-ink)]/80 transition-colors hover:bg-white/10"
                >
                  <ArrowLeft className="h-4 w-4" />
                </button>
                {active.kind === "group" ? (
                  <span className="flex h-7 w-7 items-center justify-center rounded-[5px] bg-[var(--chat-accent)] text-[var(--chat-accent-ink)]">
                    <Users className="h-4 w-4" />
                  </span>
                ) : (
                  <Avatar label={roomLabel(active)} seed={active.id} size={28} src={avatars[dmPartner(active)?.id || ""]} />
                )}
                <div className="truncate text-sm font-semibold text-[var(--chat-header-ink)]">
                  {roomLabel(active)}
                </div>
              </div>
              <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto bg-[var(--chat-bg)] p-3">
                {messages.length === 0 && (
                  <div className="pt-12 text-center text-xs text-[var(--chat-sub)]">
                    Chưa có tin nhắn. Gửi tin đầu tiên nhé.
                  </div>
                )}
                {messages.map((m) => {
                  const mine = m.user_id === me;
                  const sender = profileOf(m.user_id);
                  return (
                    <div
                      key={m.id}
                      className={`group flex items-start gap-2 ${mine ? "flex-row-reverse" : ""}`}
                    >
                      <Avatar label={nameOf(sender, "?")} seed={m.user_id} size={34} src={avatars[m.user_id]} />
                      <div className={`flex max-w-[72%] flex-col ${mine ? "items-end" : "items-start"}`}>
                        {!mine && active.kind === "group" && (
                          <div className="mb-0.5 px-0.5 text-[11px] text-[var(--chat-sub)]">
                            {nameOf(sender, "—")}
                          </div>
                        )}
                        <div
                          className={`relative rounded-lg px-3 py-2 text-sm shadow-sm ${
                            mine
                              ? "rounded-tr-sm bg-[var(--chat-bubble-me)] text-[var(--chat-bubble-me-ink)]"
                              : "rounded-tl-sm border border-[var(--chat-line)] bg-[var(--chat-bubble-other)] text-[var(--chat-ink)]"
                          }`}
                        >
                          <div className="whitespace-pre-wrap break-words">{m.body}</div>
                          <div
                            className={`mt-1 flex items-center gap-1.5 text-[10px] ${
                              mine ? "justify-end text-[var(--chat-bubble-me-ink)]/55" : "text-[var(--chat-sub)]"
                            }`}
                          >
                            {fmt(m.created_at)}
                            {isAdmin && (
                              <button
                                aria-label="Xóa tin nhắn"
                                onClick={() => remove(m.id)}
                                className="hidden text-[var(--chat-danger)] group-hover:inline"
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="flex items-center gap-2 border-t border-[var(--chat-line)] bg-[var(--chat-panel)] p-2.5">
                <input
                  ref={inputRef}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") send();
                  }}
                  placeholder="Nhập tin nhắn…"
                  className="h-9 flex-1 rounded-lg border border-[var(--chat-line)] bg-[var(--chat-bg)] px-3 text-sm text-[var(--chat-ink)] outline-none transition-shadow focus:border-[var(--chat-accent)] focus:ring-2 focus:ring-[var(--chat-accent)]/25"
                />
                <button
                  aria-label="Gửi"
                  onClick={send}
                  disabled={sending || !draft.trim()}
                  className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--chat-accent)] text-[var(--chat-accent-ink)] transition-colors hover:brightness-95 disabled:opacity-40"
                >
                  <Send className="h-4 w-4" />
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}
