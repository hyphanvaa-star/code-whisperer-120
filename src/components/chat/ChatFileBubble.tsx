import { useEffect, useState } from "react";
import { FileText, Download } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { fileSize, type ChatFile } from "./chat-content";

const urlCache = new Map<string, { url: string; exp: number }>();
async function signed(path: string) {
  const hit = urlCache.get(path);
  if (hit && hit.exp > Date.now()) return hit.url;
  const { data } = await supabase.storage.from("chat-files").createSignedUrl(path, 3600);
  if (data?.signedUrl) urlCache.set(path, { url: data.signedUrl, exp: Date.now() + 3000_000 });
  return data?.signedUrl ?? "";
}

export function ChatFileBubble({ file, mine }: { file: ChatFile; mine: boolean }) {
  const [url, setUrl] = useState("");
  const [zoom, setZoom] = useState(false);
  useEffect(() => {
    let live = true;
    void signed(file.path).then((u) => live && setUrl(u));
    return () => {
      live = false;
    };
  }, [file.path]);
  const isImage = file.type.startsWith("image/");
  const download = async () => {
    const u = url || (await signed(file.path));
    if (!u) return;
    const res = await fetch(u);
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = file.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  if (isImage)
    return (
      <>
        <button type="button" onClick={() => setZoom(true)} aria-label={`Xem ảnh ${file.name}`} className="block">
          {url ? (
            <img src={url} alt={file.name} className="max-h-64 max-w-[16rem] rounded-xl object-cover" />
          ) : (
            <div className="h-40 w-56 animate-pulse rounded-xl bg-[var(--chat-bubble-other)]" />
          )}
        </button>
        {zoom && url && (
          <div
            role="dialog"
            aria-label={file.name}
            onClick={() => setZoom(false)}
            className="fixed inset-0 z-[10000] flex flex-col items-center justify-center gap-3 bg-foreground/80 p-6"
          >
            <img src={url} alt={file.name} className="max-h-[85vh] max-w-full rounded-lg object-contain" />
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                void download();
              }}
              className="flex items-center gap-2 rounded-full bg-background px-4 py-2 text-sm font-semibold text-foreground"
            >
              <Download className="h-4 w-4" /> Tải về
            </button>
          </div>
        )}
      </>
    );
  return (
    <button
      type="button"
      onClick={() => void download()}
      title="Tải về"
      className={`flex max-w-[18rem] items-center gap-3 rounded-2xl px-3 py-2.5 text-left ${mine ? "bg-[var(--chat-bubble-me)] text-[var(--chat-bubble-me-ink)]" : "bg-[var(--chat-bubble-other)] text-[var(--chat-ink)]"}`}
    >
      <FileText className="h-8 w-8 shrink-0" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{file.name}</span>
        <span className="block text-xs opacity-75">{fileSize(file.size)}</span>
      </span>
      <Download className="h-5 w-5 shrink-0" />
    </button>
  );
}
