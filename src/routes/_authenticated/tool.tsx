import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/tool")({
  head: () => ({
    meta: [
      { title: "Dispatch Board — Flight Dispatch Tool" },
      { name: "description", content: "Bảng điều phối chuyến bay VietJet: KHB, NOTAM, ATC, giới hạn tàu, giao ca." },
      { property: "og:title", content: "Dispatch Board — Flight Dispatch Tool" },
      { property: "og:description", content: "Bảng điều phối chuyến bay cho nhóm dispatcher." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ToolPage,
});

declare global {
  interface Window {
    __fbToken?: () => string | null;
  }
}

function ToolPage() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let token: string | null = null;
    window.__fbToken = () => token;
    supabase.auth.getSession().then(({ data }) => {
      token = data.session?.access_token ?? null;
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      token = s?.access_token ?? null;
      if (!s) window.location.href = "/auth";
    });
    return () => sub.subscription.unsubscribe();
  }, []);
  if (!ready) return <div className="p-6 text-sm text-muted-foreground">Đang mở Dispatch Board…</div>;
  return (
    <iframe
      title="Dispatch Board"
      src="/tool-page?v=20261006-0012"
      className="fixed inset-0 h-screen w-screen border-0"
    />
  );
}
