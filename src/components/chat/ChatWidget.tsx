import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { MessageCircle, X, Trash2, ArrowLeft, Send } from "lucide-react";

type Room = { id: string; kind: string; name: string; dm_key: string | null };
type Msg = { id: string; room_id: string; user_id: string; body: string; created_at: string };
type Profile = { id: string; email: string | null; display_name: string | null };

const GROUP_NAME = "Phòng chung";

function nameOf(p: Profile | undefined, fallback: string) {
  return (p?.display_name || p?.email || fallback).toString();
}

export function ChatWidget() {
  const [me, setMe] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [open, setOpen] = useState(false);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [active, setActive] = useState<Room | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;
    supabase.auth.getUser().then(({ data }) => {
      if (!alive || !data.user) return;
      setMe(data.user.id);
      supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", data.user.id)
        .then(({ data: roles }) => {
          if (alive) setIsAdmin(!!roles?.some((r) => r.role === "admin"));
        });
    });
    return () => {
      alive = false;
    };
  }, []);

  const loadRooms = useCallback(async () => {
    const { data } = await supabase.from("chat_rooms").select("id,kind,name,dm_key").order("created_at");
    let list = (data as Room[] | null) ?? [];
    if (!list.some((r) => r.kind === "group")) {
      const { data: created } = await supabase
        .from("chat_rooms")
        .insert({ kind: "group", name: GROUP_NAME })
        .select("id,kind,name,dm_key")
        .single();
      if (created) list = [created as Room, ...list];
      else {
        const again = await supabase.from("chat_rooms").select("id,kind,name,dm_key").order("created_at");
        list = (again.data as Room[] | null) ?? [];
      }
    }
    setRooms(list);
    return list;
  }, []);

  const loadProfiles = useCallback(async () => {
    const { data } = await supabase.from("profiles").select("id,email,display_name");
    setProfiles((data as Profile[] | null) ?? []);
  }, []);

  useEffect(() => {
    if (!me || !open) return;
    loadRooms();
    loadProfiles();
  }, [me, open, loadRooms, loadProfiles]);

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

  if (!me) return null;

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
      if (room) setRooms((prev) => [...prev, room!]);
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
      <button
        aria-label="Chat nội bộ"
        onClick={() => setOpen((v) => !v)}
        className="fixed bottom-5 right-5 z-50 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg hover:bg-primary/90"
      >
        {open ? <X className="h-5 w-5" /> : <MessageCircle className="h-5 w-5" />}
      </button>

      {open && (
        <div className="fixed bottom-20 right-5 z-50 flex h-[480px] w-[360px] max-w-[calc(100vw-2.5rem)] flex-col overflow-hidden rounded-xl border border-border bg-background shadow-2xl">
          {!active ? (
            <>
              <div className="border-b border-border px-4 py-3 text-sm font-semibold text-foreground">
                Chat nội bộ
              </div>
              <div className="flex-1 overflow-y-auto p-2">
                {rooms
                  .filter((r) => r.kind === "group")
                  .map((r) => (
                    <button
                      key={r.id}
                      onClick={() => setActive(r)}
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm font-medium text-foreground hover:bg-accent"
                    >
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/15 text-xs font-bold text-primary">
                        #
                      </span>
                      {roomLabel(r)}
                    </button>
                  ))}
                <div className="px-3 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Chat riêng
                </div>
                {profiles
                  .filter((p) => p.id !== me)
                  .map((p) => (
                    <button
                      key={p.id}
                      onClick={() => openDm(p.id)}
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm text-foreground hover:bg-accent"
                    >
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-xs font-bold text-muted-foreground">
                        {nameOf(p, "?").slice(0, 1).toUpperCase()}
                      </span>
                      {nameOf(p, p.id)}
                    </button>
                  ))}
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
                <button
                  aria-label="Quay lại"
                  onClick={() => setActive(null)}
                  className="rounded-md p-1 text-muted-foreground hover:bg-accent"
                >
                  <ArrowLeft className="h-4 w-4" />
                </button>
                <div className="truncate text-sm font-semibold text-foreground">{roomLabel(active)}</div>
              </div>
              <div ref={listRef} className="flex-1 space-y-2 overflow-y-auto bg-muted/30 p-3">
                {messages.length === 0 && (
                  <div className="pt-10 text-center text-xs text-muted-foreground">
                    Chưa có tin nhắn. Gửi tin đầu tiên nhé.
                  </div>
                )}
                {messages.map((m) => {
                  const mine = m.user_id === me;
                  return (
                    <div key={m.id} className={`group flex ${mine ? "justify-end" : "justify-start"}`}>
                      <div
                        className={`max-w-[78%] rounded-2xl px-3 py-1.5 text-sm ${
                          mine
                            ? "bg-primary text-primary-foreground"
                            : "bg-background text-foreground border border-border"
                        }`}
                      >
                        {!mine && active.kind === "group" && (
                          <div className="text-[10px] font-semibold text-muted-foreground">
                            {nameOf(profileOf(m.user_id), "—")}
                          </div>
                        )}
                        <div className="whitespace-pre-wrap break-words">{m.body}</div>
                        <div
                          className={`mt-0.5 flex items-center gap-1 text-[10px] ${
                            mine ? "justify-end text-primary-foreground/70" : "text-muted-foreground"
                          }`}
                        >
                          {fmt(m.created_at)}
                          {isAdmin && (
                            <button
                              aria-label="Xóa tin nhắn"
                              onClick={() => remove(m.id)}
                              className="hidden text-destructive group-hover:inline"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="flex items-center gap-2 border-t border-border p-2">
                <input
                  ref={inputRef}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") send();
                  }}
                  placeholder="Nhập tin nhắn…"
                  className="h-9 flex-1 rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus:ring-1 focus:ring-ring"
                />
                <button
                  aria-label="Gửi"
                  onClick={send}
                  disabled={sending || !draft.trim()}
                  className="flex h-9 w-9 items-center justify-center rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
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
