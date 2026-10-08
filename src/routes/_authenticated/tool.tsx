import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
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
  const [toolVersion, setToolVersion] = useState("");
  const ctx = Route.useRouteContext();
  const navigate = useNavigate();
  const frame = useRef<HTMLIFrameElement>(null);
  const emailRef = useRef("");

  const sendAccount = useCallback(() => {
    frame.current?.contentWindow?.postMessage(
      { type: "sohee-account", email: emailRef.current },
      window.location.origin,
    );
  }, []);

  const signOut = useCallback(async () => {
    await ctx.queryClient.cancelQueries();
    ctx.queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }, [ctx.queryClient, navigate]);

  useEffect(() => {
    let token: string | null = null;
    window.__fbToken = () => token;
    supabase.auth.getSession().then(({ data }) => {
      token = data.session?.access_token ?? null;
      emailRef.current = data.session?.user.email ?? "";
      setToolVersion(`${Date.now()}`);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      token = s?.access_token ?? null;
      emailRef.current = s?.user.email ?? "";
      if (!s) void navigate({ to: "/auth", replace: true });
    });
    const onMessage = (ev: MessageEvent) => {
      if (ev.origin !== window.location.origin) return;
      const d = (ev.data || {}) as { type?: string };
      if (d.type === "sohee-signout") void signOut();
      if (d.type === "sohee-account-request") sendAccount();
    };
    window.addEventListener("message", onMessage);
    return () => {
      sub.subscription.unsubscribe();
      window.removeEventListener("message", onMessage);
    };
  }, [navigate, sendAccount, signOut]);

  if (!ready || !toolVersion) return <div className="p-6 text-sm text-muted-foreground">Đang mở Dispatch Board…</div>;
  return (
    <iframe
      ref={frame}
      key={toolVersion}
      title="Dispatch Board"
      src={`/tool-page?v=${toolVersion}`}
      onLoad={sendAccount}
      className="fixed inset-0 h-screen w-screen border-0"
    />
  );
}
