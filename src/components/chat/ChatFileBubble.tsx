import { useEffect, useState } from "react";
import {
  Download,
  File as FileGeneric,
  FileArchive,
  FileSpreadsheet,
  FileText,
  FileCode,
  Image as ImageGlyph,
  Loader2,
  Presentation,
  RotateCw,
  X,
  AlertTriangle,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { fileExt, fileKind, fileSize, type ChatFile, type FileKind } from "./chat-content";

const urlCache = new Map<string, { url: string; exp: number }>();
async function signed(path: string) {
  const hit = urlCache.get(path);
  if (hit && hit.exp > Date.now()) return hit.url;
  const { data } = await supabase.storage.from("chat-files").createSignedUrl(path, 3600);
  if (data?.signedUrl) urlCache.set(path, { url: data.signedUrl, exp: Date.now() + 3000_000 });
  return data?.signedUrl ?? "";
}

const KIND_STYLE: Record<FileKind, { color: string; Icon: typeof FileText; label: string }> = {
  image: { color: "var(--chat-file-image)", Icon: ImageGlyph, label: "Ảnh" },
  pdf: { color: "var(--chat-file-pdf)", Icon: FileText, label: "PDF" },
  sheet: { color: "var(--chat-file-sheet)", Icon: FileSpreadsheet, label: "Excel" },
  doc: { color: "var(--chat-file-doc)", Icon: FileText, label: "Word" },
  slide: { color: "var(--chat-file-slide)", Icon: Presentation, label: "Slide" },
  archive: { color: "var(--chat-file-archive)", Icon: FileArchive, label: "Nén" },
  text: { color: "var(--chat-file-text)", Icon: FileCode, label: "Văn bản" },
  other: { color: "var(--chat-file-other)", Icon: FileGeneric, label: "Tệp" },
};

/** Ô biểu tượng màu theo loại tệp, có nhãn đuôi tệp. */
export function FileTypeIcon({ name, type, size = 44 }: { name: string; type: string; size?: number }) {
  const { color, Icon } = KIND_STYLE[fileKind(name, type)];
  return (
    <span
      aria-hidden
      className="relative flex shrink-0 flex-col items-center justify-center rounded-xl text-[var(--chat-accent-ink)] shadow-[var(--chat-card-shadow)]"
      style={{ width: size, height: size, background: color }}
    >
      <Icon style={{ width: size * 0.42, height: size * 0.42 }} strokeWidth={2.2} />
      <span className="mt-0.5 text-[9px] font-extrabold leading-none tracking-wide">{fileExt(name).slice(0, 4)}</span>
    </span>
  );
}

export function ChatFileBubble({
  file,
  mine,
  localUrl,
  uploading,
}: {
  file: ChatFile;
  mine: boolean;
  localUrl?: string;
  uploading?: boolean;
}) {
  const [url, setUrl] = useState(localUrl ?? "");
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [zoom, setZoom] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dlError, setDlError] = useState(false);
  useEffect(() => {
    if (localUrl) {
      setUrl(localUrl);
      return;
    }
    let live = true;
    setFailed(false);
    void signed(file.path)
      .then((u) => {
        if (!live) return;
        setUrl(u);
        setFailed(!u);
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [file.path, localUrl, retry]);
  const kind = fileKind(file.name, file.type);
  const download = async () => {
    if (uploading || busy) return;
    setBusy(true);
    setDlError(false);
    try {
      const u = url || (await signed(file.path));
      if (!u) throw new Error("no url");
      const res = await fetch(u);
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = file.name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    } catch {
      setDlError(true);
    } finally {
      setBusy(false);
    }
  };

  if (kind === "image")
    return (
      <>
        <button
          type="button"
          onClick={() => url && !uploading && setZoom(true)}
          aria-label={`Xem ảnh ${file.name}`}
          className="group/img relative block overflow-hidden rounded-2xl shadow-[var(--chat-card-shadow)] ring-1 ring-[var(--chat-line)]"
        >
          {failed ? (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                urlCache.delete(file.path);
                setRetry((n) => n + 1);
              }}
              className="flex h-32 w-56 flex-col items-center justify-center gap-1.5 bg-[var(--chat-bubble-other)] text-xs text-[var(--chat-sub)]"
            >
              <AlertTriangle className="h-5 w-5 text-[var(--chat-danger)]" />
              Không tải được ảnh
              <span className="flex items-center gap-1 font-semibold text-[var(--chat-accent)]">
                <RotateCw className="h-3.5 w-3.5" /> Thử lại
              </span>
            </span>
          ) : url ? (
            <img
              src={url}
              alt={file.name}
              onError={() => setFailed(true)}
              className={`block max-h-64 max-w-[16rem] object-cover transition-transform duration-300 group-hover/img:scale-[1.03] ${uploading ? "opacity-60" : ""}`}
            />
          ) : (
            <span className="block h-40 w-56 animate-pulse bg-[var(--chat-bubble-other)]" />
          )}
          {uploading && (
            <span className="absolute inset-0 flex items-center justify-center">
              <span className="flex items-center gap-1.5 rounded-full bg-[var(--chat-panel)] px-3 py-1 text-xs font-semibold text-[var(--chat-ink)] shadow-[var(--chat-card-shadow)]">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--chat-accent)]" /> Đang gửi…
              </span>
            </span>
          )}
        </button>
        {zoom && url && (
          <div
            role="dialog"
            aria-label={file.name}
            onClick={() => setZoom(false)}
            className="fixed inset-0 z-[10000] flex flex-col items-center justify-center gap-4 bg-[var(--chat-scrim)] p-6"
          >
            <button
              type="button"
              aria-label="Đóng ảnh"
              onClick={() => setZoom(false)}
              className="absolute right-5 top-5 flex h-10 w-10 items-center justify-center rounded-full bg-[var(--chat-panel)] text-[var(--chat-ink)] shadow-[var(--chat-card-shadow)]"
            >
              <X className="h-5 w-5" />
            </button>
            <img
              src={url}
              alt={file.name}
              onClick={(e) => e.stopPropagation()}
              className="max-h-[80vh] max-w-full rounded-2xl object-contain shadow-[var(--chat-window-shadow)]"
            />
            <div className="flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
              <span className="max-w-[50vw] truncate text-sm font-semibold text-[var(--chat-accent-ink)]">{file.name}</span>
              <button
                type="button"
                onClick={() => void download()}
                className="flex items-center gap-2 rounded-full bg-[var(--chat-accent)] px-4 py-2 text-sm font-semibold text-[var(--chat-accent-ink)] shadow-[var(--chat-card-shadow)]"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Tải về
              </button>
            </div>
          </div>
        )}
      </>
    );

  const style = KIND_STYLE[kind];
  return (
    <button
      type="button"
      onClick={() => void download()}
      title={uploading ? "Đang gửi…" : `Tải về ${file.name}`}
      aria-label={`Tải về ${file.name}`}
      className={`flex w-[17rem] max-w-full items-center gap-3 rounded-2xl border bg-[var(--chat-panel)] px-3 py-2.5 text-left text-[var(--chat-ink)] shadow-[var(--chat-card-shadow)] transition hover:-translate-y-0.5 ${mine ? "border-[var(--chat-accent)]/40" : "border-[var(--chat-line)]"}`}
    >
      <FileTypeIcon name={file.name} type={file.type} />
      <span className="min-w-0 flex-1">
        <span className="line-clamp-2 break-all text-sm font-semibold leading-snug">{file.name}</span>
        <span className="mt-0.5 flex items-center gap-1.5 text-xs text-[var(--chat-sub)]">
          <span className="font-semibold" style={{ color: style.color }}>
            {style.label}
          </span>
          · {fileSize(file.size)}
          {dlError && <span className="font-semibold text-[var(--chat-danger)]">· Lỗi tải, bấm lại</span>}
        </span>
      </span>
      <span
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
        style={{ background: `color-mix(in oklch, ${style.color} 14%, transparent)`, color: style.color }}
      >
        {uploading || busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
      </span>
    </button>
  );
}
