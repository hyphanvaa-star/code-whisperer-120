import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getChatAvatars } from "@/lib/account.functions";
import { supabase } from "@/integrations/supabase/client";
import { MessageCircle, X, Trash2, ArrowLeft, Send, Users, Smile, SmilePlus, Sticker, Paperclip, ImagePlus, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChatPicker, STICKERS } from "./ChatPicker";
import { ChatFileBubble, FileTypeIcon } from "./ChatFileBubble";
import {
  REACTIONS,
  countUnread,
  groupReactions,
  insertEmoji,
  messageParts,
  isEmojiOnly,
  readSticker,
  stickerBody,
  fileBody,
  readFile,
  CHAT_FILE_MAX,
  type Reaction,
  type StickerId,
} from "./chat-content";

type Room = { id: string; kind: string; name: string; dm_key: string | null };
type Msg = { id: string; room_id: string; user_id: string; body: string; created_at: string };
type Staged = { id: string; file: File; url: string };
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
  const [picker, setPicker] = useState<"emoji" | "stickers" | null>(null);
  const [reactionMenu, setReactionMenu] = useState<string | null>(null);
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const [reactionBusy, setReactionBusy] = useState(false);
  const [chatError, setChatError] = useState("");
  const [staged, setStaged] = useState<Staged[]>([]);
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

  const pendingRef = useRef<Msg[]>([]);
  // Bộ nhớ đệm theo phòng: mở lại phòng hiện ngay tin đã có, không trắng khung khi mạng chậm.
  const cacheRef = useRef<Record<string, { msgs: Msg[]; reactions: Reaction[] }>>({});
  const inFlightRef = useRef<Record<string, boolean>>({});
  // Phòng nào đã tải thành công ít nhất một lần, và lượt tải gần nhất có lỗi không.
  const [loadedRoom, setLoadedRoom] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const loadMessages = useCallback(async (roomId: string, force = false) => {
    // Không chồng lượt tải: lượt cũ còn chạy thì lượt định kỳ bỏ qua (gửi tin vẫn ép tải).
    if (inFlightRef.current[roomId] && !force) return;
    inFlightRef.current[roomId] = true;
    try {
      const { data, error } = await supabase
        .from("chat_messages")
        .select("id,room_id,user_id,body,created_at")
        .eq("room_id", roomId)
        .order("created_at", { ascending: false })
        .limit(200);
      if (activeRoomRef.current !== roomId) return;
      if (error || !data) {
        // Giữ nguyên tin đang hiện; chỉ báo mạng chậm, lượt sau tự thử lại.
        setLoadFailed(true);
        return;
      }
      // Lấy 200 tin MỚI NHẤT rồi xếp cũ → mới để đáy khung luôn là tin gần nhất.
      const nextMessages = (data as Msg[])
        .slice()
        .sort((a, b) => a.created_at.localeCompare(b.created_at));
      const prev = cacheRef.current[roomId];
      const same =
        prev &&
        prev.msgs.length === nextMessages.length &&
        prev.msgs.every((m, i) => m.id === nextMessages[i].id && m.body === nextMessages[i].body);
      cacheRef.current[roomId] = { msgs: nextMessages, reactions: prev?.reactions ?? [] };
      setLoadFailed(false);
      setLoadedRoom(roomId);
      // Giữ tin vừa gửi (chưa lưu xong) để lượt tải định kỳ không làm nó biến mất.
      const pending = pendingRef.current.filter((m) => m.room_id === roomId);
      if (!same || pending.length || force)
        setMessages(pending.length ? [...nextMessages, ...pending] : nextMessages);
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
      if (activeRoomRef.current === roomId && !result.error) {
        const rows = result.data ?? [];
        cacheRef.current[roomId] = { msgs: nextMessages, reactions: rows };
        setReactions(rows);
      }
    } catch {
      if (activeRoomRef.current === roomId) setLoadFailed(true);
    } finally {
      inFlightRef.current[roomId] = false;
    }
  }, []);

  useEffect(() => {
    activeRoomRef.current = active?.id ?? null;
    const cached = active ? cacheRef.current[active.id] : undefined;
    setMessages(cached?.msgs ?? []);
    setReactions(cached?.reactions ?? []);
    setLoadedRoom(cached && active ? active.id : null);
    setLoadFailed(false);
    setPicker(null);
    setReactionMenu(null);
    setChatError("");
    setStaged((prev) => {
      prev.forEach((f) => f.url && URL.revokeObjectURL(f.url));
      return [];
    });
    if (!active || !open) return;
    loadMessages(active.id);
    const t = setInterval(() => loadMessages(active.id), 4000);
    return () => clearInterval(t);
  }, [active, open, loadMessages]);

  // Neo đáy kiểu Messenger: mở chat/đổi phòng luôn ở tin mới nhất, kể cả khi ảnh/avatar tải xong
  // làm danh sách cao thêm. Người dùng kéo lên đọc tin cũ thì không bị giật xuống.
  const stickRef = useRef(true);
  const [showJump, setShowJump] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const toBottom = useCallback(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);
  useLayoutEffect(() => {
    stickRef.current = true;
    setShowJump(false);
  }, [active?.id, open]);
  useLayoutEffect(() => {
    if (stickRef.current) toBottom();
  }, [messages, active?.id, open, toBottom]);
  useEffect(() => {
    const el = contentRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      if (stickRef.current) toBottom();
    });
    ro.observe(el);
    // Khung danh sách co lại khi hiện khay tệp/bảng emoji → vẫn giữ đáy.
    if (listRef.current) ro.observe(listRef.current);
    return () => ro.disconnect();
  }, [active?.id, open, toBottom]);
  const onListScroll = () => {
    const el = listRef.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    stickRef.current = near;
    setShowJump(!near);
  };

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
      // Một lượt đọc cho mọi phòng (trước đây mỗi phòng một yêu cầu → ~38 yêu cầu mỗi 6 giây).
      const sinceByRoom: Record<string, string> = {};
      for (const r of list) {
        const key = `chat.read.${me}.${r.id}`;
        let since = localStorage.getItem(key);
        if (!since) {
          since = new Date().toISOString();
          localStorage.setItem(key, since);
        }
        sinceByRoom[r.id] = since;
      }
      const marks = Object.values(sinceByRoom).sort();
      if (!marks.length) return;
      const { data, error } = await supabase
        .from("chat_messages")
        .select("room_id,user_id,created_at")
        .neq("user_id", me)
        .gt("created_at", marks[0])
        .order("created_at", { ascending: false })
        .limit(1000);
      if (!alive || error || !data) return;
      const next = countUnread(data, sinceByRoom, me);
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
    if (!body || !active) return;
    const roomId = active.id;
    // Hiện tin ngay khi bấm gửi, lưu lên máy chủ ở nền (kiểu Messenger).
    const temp: Msg = { id: `pending-${Date.now()}-${Math.random().toString(36).slice(2)}`, room_id: roomId, user_id: me, body, created_at: new Date().toISOString() };
    pendingRef.current = [...pendingRef.current, temp];
    setMessages((prev) => [...prev, temp]);
    if (!sticker) setDraft("");
    setPicker(null);
    setChatError("");
    stickRef.current = true;
    inputRef.current?.focus();
    const drop = () => { pendingRef.current = pendingRef.current.filter((m) => m.id !== temp.id); };
    try {
      const { error } = await supabase
        .from("chat_messages")
        .insert({ room_id: roomId, user_id: me, body });
      if (error) throw error;
      drop();
      if (activeRoomRef.current === roomId) await loadMessages(roomId, true);
    } catch {
      drop();
      setMessages((prev) => prev.filter((m) => m.id !== temp.id));
      if (!sticker) setDraft((d) => d || body);
      setChatError("Chưa gửi được tin nhắn. Vui lòng thử lại.");
    }
  };

  const fileRef = useRef<HTMLInputElement>(null);
  const imageRef = useRef<HTMLInputElement>(null);
  const [localPreview, setLocalPreview] = useState<Record<string, string>>({});
  /** Chọn/dán/kéo thả tệp → vào khay xem trước, bấm Gửi mới gửi. */
  const stageFiles = (files: File[]) => {
    if (!files.length) return;
    const ok: Staged[] = [];
    const tooBig: string[] = [];
    for (const f of files) {
      if (f.size > CHAT_FILE_MAX) tooBig.push(f.name);
      else
        ok.push({
          id: crypto.randomUUID(),
          file: f,
          url: f.type.startsWith("image/") ? URL.createObjectURL(f) : "",
        });
    }
    setChatError(tooBig.length ? `${tooBig.join(", ")} quá 20 MB, chưa gửi được.` : "");
    if (ok.length) setStaged((prev) => [...prev, ...ok]);
    inputRef.current?.focus();
  };
  const unstage = (id: string) =>
    setStaged((prev) => {
      const hit = prev.find((f) => f.id === id);
      if (hit?.url) URL.revokeObjectURL(hit.url);
      return prev.filter((f) => f.id !== id);
    });

  const sendFiles = async (items: Staged[]) => {
    if (!active || !items.length) return;
    const roomId = active.id;
    setChatError("");
    stickRef.current = true;
    // Hiện ngay bong bóng tệp "Đang gửi…" rồi tải lên ở nền.
    const temps = items.map((it) => {
      const name = it.file.name || `anh-${Date.now()}.png`;
      const msg: Msg = {
        id: `pending-${it.id}`,
        room_id: roomId,
        user_id: me,
        body: fileBody({ path: `local/${it.id}`, name, size: it.file.size, type: it.file.type || "" }),
        created_at: new Date().toISOString(),
      };
      return { it, name, msg };
    });
    pendingRef.current = [...pendingRef.current, ...temps.map((t) => t.msg)];
    setMessages((prev) => [...prev, ...temps.map((t) => t.msg)]);
    setLocalPreview((prev) => {
      const next = { ...prev };
      temps.forEach((t) => t.it.url && (next[t.msg.id] = t.it.url));
      return next;
    });
    const failed: Staged[] = [];
    const done: string[] = [];
    for (const { it, name, msg } of temps) {
      try {
        const safe = name.replace(/[^\w.\-]+/g, "_").slice(-80);
        const path = `${roomId}/${me}/${crypto.randomUUID()}-${safe}`;
        const up = await supabase.storage
          .from("chat-files")
          .upload(path, it.file, { contentType: it.file.type || "application/octet-stream" });
        if (up.error) throw up.error;
        const { error } = await supabase.from("chat_messages").insert({
          room_id: roomId,
          user_id: me,
          body: fileBody({ path, name, size: it.file.size, type: it.file.type || "" }),
        });
        if (error) throw error;
        done.push(msg.id);
      } catch {
        failed.push(it);
      }
      pendingRef.current = pendingRef.current.filter((m) => m.id !== msg.id);
    }
    if (activeRoomRef.current === roomId) await loadMessages(roomId, true);
    setMessages((prev) => prev.filter((m) => !temps.some((t) => t.msg.id === m.id)));
    setLocalPreview((prev) => {
      const next = { ...prev };
      temps.forEach((t) => delete next[t.msg.id]);
      return next;
    });
    temps.forEach((t) => done.includes(t.msg.id) && t.it.url && URL.revokeObjectURL(t.it.url));
    if (failed.length) {
      // Trả tệp lỗi về khay để bấm gửi lại, không mất tệp đã chọn.
      if (activeRoomRef.current === roomId) setStaged((prev) => [...failed, ...prev]);
      setChatError(
        `Chưa gửi được ${failed.map((f) => f.file.name).join(", ")}. Tệp vẫn nằm trong khay — bấm Gửi để thử lại.`,
      );
    }
  };

  const submit = () => {
    const files = staged;
    if (draft.trim()) void send();
    if (files.length) {
      setStaged([]);
      void sendFiles(files);
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
        await loadMessages(roomId, true);
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
    loadMessages(active.id, true);
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
              <div className="relative flex min-h-0 flex-1 flex-col">
              <div
                ref={listRef}
                onScroll={onListScroll}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  stageFiles(Array.from(e.dataTransfer.files));
                }}
                className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-[var(--chat-bg)] p-4"
              >
                <div ref={contentRef} className="space-y-4">
                {messages.length === 0 && (
                  <div className="pt-12 text-center text-xs text-[var(--chat-sub)]">
                    {loadedRoom === active.id && !loadFailed
                      ? "Chưa có tin nhắn. Gửi tin đầu tiên nhé."
                      : loadFailed
                        ? "Mạng đang chậm, đang tải lại tin nhắn…"
                        : "Đang tải tin nhắn…"}
                  </div>
                )}
                {messages.length > 0 && loadFailed && (
                  <div className="text-center text-[11px] text-[var(--chat-sub)]">
                    Mạng đang chậm — đang thử tải tin mới…
                  </div>
                )}
                {messages.map((m) => {
                  const mine = m.user_id === me;
                  const sender = profileOf(m.user_id);
                  const attached = readFile(m.body);
                  const sticker = readSticker(m.body);
                  const emojiOnly = !sticker && !attached && isEmojiOnly(m.body);
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
                          className={`relative ${sticker || emojiOnly || attached ? "px-1 py-1 text-[var(--chat-ink)]" : `rounded-2xl px-4 py-2.5 text-base leading-relaxed ${mine ? "bg-[var(--chat-bubble-me)] text-[var(--chat-bubble-me-ink)]" : "bg-[var(--chat-bubble-other)] text-[var(--chat-ink)]"}`}`}
                        >
                          {attached ? (
                            <ChatFileBubble
                              file={attached}
                              mine={mine}
                              localUrl={localPreview[m.id]}
                              uploading={m.id.startsWith("pending-")}
                            />
                          ) : sticker ? (
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
                              mine && !sticker && !emojiOnly && !attached
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
              </div>
              {showJump && (
                <button
                  type="button"
                  aria-label="Xuống tin mới nhất"
                  onClick={() => {
                    stickRef.current = true;
                    setShowJump(false);
                    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
                  }}
                  className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full border border-[var(--chat-line)] bg-[var(--chat-panel)] px-3 py-1.5 text-xs font-semibold text-[var(--chat-accent)] shadow-[var(--chat-card-shadow)]"
                >
                  <ChevronDown className="h-4 w-4" /> Tin mới nhất
                </button>
              )}
              </div>
              {chatError && (
                <div role="alert" className="px-3 py-1 text-xs text-[var(--chat-danger)]">
                  {chatError}
                </div>
              )}
              {picker && (
                <ChatPicker
                  mode={picker}
                  busy={false}
                  onEmoji={addEmoji}
                  onSticker={(id) => void send(id)}
                />
              )}
              {staged.length > 0 && (
                <div className="shrink-0 border-t border-[var(--chat-line)] bg-[var(--chat-panel)] px-3 pt-2.5">
                  <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--chat-sub)]">
                    Sẵn sàng gửi {staged.length} tệp
                  </div>
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {staged.map((f) => (
                      <div
                        key={f.id}
                        title={f.file.name}
                        className="relative flex h-16 shrink-0 items-center gap-2 rounded-xl border border-[var(--chat-line)] bg-[var(--chat-bg)] p-1.5 pr-3 shadow-[var(--chat-card-shadow)]"
                      >
                        {f.url ? (
                          <img src={f.url} alt={f.file.name} className="h-[52px] w-[52px] rounded-lg object-cover" />
                        ) : (
                          <FileTypeIcon name={f.file.name} type={f.file.type} size={44} />
                        )}
                        {!f.url && (
                          <span className="max-w-[8rem] truncate text-xs font-semibold text-[var(--chat-ink)]">
                            {f.file.name}
                          </span>
                        )}
                        <button
                          type="button"
                          aria-label={`Bỏ ${f.file.name}`}
                          onClick={() => unstage(f.id)}
                          className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--chat-ink)] text-[var(--chat-panel)] shadow-[var(--chat-card-shadow)]"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="flex shrink-0 items-center gap-1.5 border-t border-[var(--chat-line)] bg-[var(--chat-panel)] px-3 py-3">
                <Button
                  variant="ghost"
                  size="icon"
                  title="Emoji"
                  aria-label="Emoji"
                  aria-expanded={picker === "emoji"}
                  onClick={() => setPicker(picker === "emoji" ? null : "emoji")}
                  className={`h-9 w-9 shrink-0 rounded-xl bg-[var(--chat-tool-emoji-soft)] text-[var(--chat-tool-emoji)] transition hover:-translate-y-0.5 hover:bg-[var(--chat-tool-emoji-soft)] hover:text-[var(--chat-tool-emoji)] hover:brightness-95 ${picker === "emoji" ? "ring-2 ring-[var(--chat-tool-emoji)]" : ""}`}
                >
                  <SmilePlus className="h-5 w-5" strokeWidth={2.2} />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  title="Nhãn dán"
                  aria-label="Nhãn dán"
                  aria-expanded={picker === "stickers"}
                  onClick={() => setPicker(picker === "stickers" ? null : "stickers")}
                  className={`h-9 w-9 shrink-0 rounded-xl bg-[var(--chat-tool-sticker-soft)] text-[var(--chat-tool-sticker)] transition hover:-translate-y-0.5 hover:bg-[var(--chat-tool-sticker-soft)] hover:text-[var(--chat-tool-sticker)] hover:brightness-95 ${picker === "stickers" ? "ring-2 ring-[var(--chat-tool-sticker)]" : ""}`}
                >
                  <Sticker className="h-5 w-5" strokeWidth={2.2} />
                </Button>
                <input
                  ref={imageRef}
                  type="file"
                  accept="image/*"
                  multiple
                  hidden
                  onChange={(e) => {
                    stageFiles(Array.from(e.target.files ?? []));
                    e.target.value = "";
                  }}
                />
                <input
                  ref={fileRef}
                  type="file"
                  multiple
                  hidden
                  onChange={(e) => {
                    stageFiles(Array.from(e.target.files ?? []));
                    e.target.value = "";
                  }}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  title="Gửi ảnh"
                  aria-label="Gửi ảnh"
                  onClick={() => imageRef.current?.click()}
                  className="h-9 w-9 shrink-0 rounded-xl bg-[var(--chat-tool-image-soft)] text-[var(--chat-tool-image)] transition hover:-translate-y-0.5 hover:bg-[var(--chat-tool-image-soft)] hover:text-[var(--chat-tool-image)] hover:brightness-95"
                >
                  <ImagePlus className="h-5 w-5" strokeWidth={2.2} />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  title="Đính kèm tệp"
                  aria-label="Đính kèm tệp"
                  onClick={() => fileRef.current?.click()}
                  className="h-9 w-9 shrink-0 rounded-xl bg-[var(--chat-tool-file-soft)] text-[var(--chat-tool-file)] transition hover:-translate-y-0.5 hover:bg-[var(--chat-tool-file-soft)] hover:text-[var(--chat-tool-file)] hover:brightness-95"
                >
                  <Paperclip className="h-5 w-5" strokeWidth={2.2} />
                </Button>
                <input
                  onPaste={(e) => {
                    const files = Array.from(e.clipboardData.files);
                    if (files.length) {
                      e.preventDefault();
                      stageFiles(files);
                    }
                  }}
                  ref={inputRef}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.nativeEvent.isComposing) submit();
                  }}
                  placeholder="Nhập tin nhắn…"
                  className="h-11 min-w-0 flex-1 rounded-full border border-transparent bg-[var(--chat-bubble-other)] px-4 text-base text-[var(--chat-ink)] outline-none transition-shadow focus:border-[var(--chat-accent)] focus:ring-2 focus:ring-[var(--chat-accent)]/25"
                />
                <Button
                  aria-label="Gửi"
                  onClick={submit}
                  disabled={!draft.trim() && !staged.length}
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
