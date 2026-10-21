import { createFileRoute } from "@tanstack/react-router";

type Variant = {
  n: number;
  name: string;
  note: string;
  bg: string;
  border: string;
  ink: string;
  dot: string;
  glow: string;
  nightBg: string;
  nightBorder: string;
  nightInk: string;
  nightDot: string;
};

const VARIANTS: Variant[] = [
  {
    n: 1,
    name: "Hiện tại (ngọc lục bảo)",
    note: "Màu đang dùng — nền kem lá, viền mint",
    bg: "linear-gradient(135deg,#ecfdf5,#d1fae5)",
    border: "#6ee7b7",
    ink: "#047857",
    dot: "#10b981",
    glow: "rgba(16,185,129,.25)",
    nightBg: "rgba(16,185,129,.14)",
    nightBorder: "rgba(110,231,183,.45)",
    nightInk: "#6ee7b7",
    nightDot: "#34d399",
  },
  {
    n: 2,
    name: "Xanh ngọc mát",
    note: "Trắng bạc hà, chữ teal — tươi, hiện đại, dịu mắt",
    bg: "linear-gradient(135deg,#f0fdfa,#ccfbf1)",
    border: "#5eead4",
    ink: "#0f766e",
    dot: "#14b8a6",
    glow: "rgba(20,184,166,.28)",
    nightBg: "rgba(45,212,191,.16)",
    nightBorder: "rgba(94,234,212,.5)",
    nightInk: "#5eead4",
    nightDot: "#2dd4bf",
  },
  {
    n: 3,
    name: "Xanh rêu trầm",
    note: "Nền rêu ấm, chữ ôliu đậm — chín, sang, không chói",
    bg: "linear-gradient(135deg,#f7f7e8,#e7ecd0)",
    border: "#b3c177",
    ink: "#4d5a1f",
    dot: "#8a9a4b",
    glow: "rgba(138,154,75,.3)",
    nightBg: "rgba(163,163,109,.18)",
    nightBorder: "rgba(201,213,140,.5)",
    nightInk: "#cdd896",
    nightDot: "#a3a36d",
  },
  {
    n: 4,
    name: "Xanh rừng đậm",
    note: "Nền lá đậm hơn, chữ gần đen rừng — rõ nhất, nghiêm nhất",
    bg: "linear-gradient(135deg,#dcfce7,#bbf7d0)",
    border: "#4ade80",
    ink: "#14532d",
    dot: "#16a34a",
    glow: "rgba(34,197,94,.3)",
    nightBg: "rgba(34,197,94,.18)",
    nightBorder: "rgba(74,222,128,.5)",
    nightInk: "#86efac",
    nightDot: "#22c55e",
  },
  {
    n: 5,
    name: "Xanh chanh tươi",
    note: "Nền chanh, chữ nõn chuối — nổi bật nhất trên nền trắng",
    bg: "linear-gradient(135deg,#f7fee7,#ecfccb)",
    border: "#bef264",
    ink: "#3f6212",
    dot: "#84cc16",
    glow: "rgba(132,204,22,.32)",
    nightBg: "rgba(132,204,22,.18)",
    nightBorder: "rgba(190,242,100,.5)",
    nightInk: "#d9f99d",
    nightDot: "#a3e635",
  },
];

const FILE = "hy6.xlsx";

function Pill({
  v,
  night,
}: {
  v: Variant;
  night: boolean;
}) {
  const bg = night ? v.nightBg : v.bg;
  const border = night ? v.nightBorder : v.border;
  const ink = night ? v.nightInk : v.ink;
  const dot = night ? v.nightDot : v.dot;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        padding: "6px 14px 6px 11px",
        borderRadius: 999,
        fontSize: 14,
        fontWeight: 700,
        whiteSpace: "nowrap",
        color: ink,
        background: bg,
        border: `1px solid ${border}`,
        boxShadow: night ? "none" : `0 2px 8px ${v.glow}`,
      }}
    >
      <span
        style={{
          width: 9,
          height: 9,
          flex: "none",
          borderRadius: "50%",
          background: dot,
          boxShadow: `0 0 0 3px ${v.glow}`,
        }}
      />
      Crewlist đang dùng: {FILE}
    </span>
  );
}

function Bar({ v, night }: { v: Variant; night: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 14px",
        borderRadius: 14,
        background: night ? "#1c2430" : "#fff",
        border: `1px solid ${night ? "#2c3745" : "#e5e7eb"}`,
        color: night ? "#cbd5e1" : "#374151",
        fontSize: 13,
        fontWeight: 700,
      }}
    >
      <span
        style={{
          padding: "5px 10px",
          borderRadius: 8,
          background: night ? "#26313f" : "#f1f3f5",
          color: night ? "#94a3b8" : "#6b7280",
          fontSize: 11,
          letterSpacing: ".08em",
        }}
      >
        CREWLIST
      </span>
      <span
        style={{
          padding: "5px 10px",
          borderRadius: 8,
          background: night ? "#26313f" : "#f1f3f5",
          color: night ? "#94a3b8" : "#6b7280",
          fontSize: 11,
          letterSpacing: ".08em",
        }}
      >
        TÀU
      </span>
      <span style={{ marginLeft: "auto" }}>
        <Pill v={v} night={night} />
      </span>
    </div>
  );
}

function Swatch({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, color: "#64748b" }}>
      <span
        style={{
          width: 14,
          height: 14,
          borderRadius: 4,
          background: color.startsWith("linear") ? "#e2e8f0" : color,
          border: "1px solid rgba(0,0,0,.12)",
        }}
      />
      {label}
    </span>
  );
}

function Sample({ v }: { v: Variant }) {
  return (
    <div
      style={{
        border: "1px solid #e5e7eb",
        borderRadius: 18,
        padding: 16,
        background: "#fff",
        boxShadow: "0 6px 18px rgba(15,23,42,.06)",
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 4 }}>
        <span
          style={{
            width: 28,
            height: 28,
            borderRadius: 9,
            background: "#111827",
            color: "#fff",
            display: "inline-grid",
            placeItems: "center",
            fontWeight: 800,
            fontSize: 14,
          }}
        >
          {v.n}
        </span>
        <strong style={{ fontSize: 17 }}>{v.name}</strong>
      </div>
      <p style={{ margin: "0 0 12px", fontSize: 13, color: "#6b7280" }}>{v.note}</p>
      <div style={{ display: "grid", gap: 10 }}>
        <Bar v={v} night={false} />
        <Bar v={v} night />
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 12 }}>
        <Swatch color={v.ink} label="chữ" />
        <Swatch color={v.border} label="viền" />
        <Swatch color={v.dot} label="chấm" />
      </div>
    </div>
  );
}

function MauNhan() {
  return (
    <div style={{ minHeight: "100vh", background: "#f4f5f7", padding: "28px 18px 60px" }}>
      <div style={{ maxWidth: 900, margin: "0 auto" }}>
        <h1 style={{ margin: 0, fontSize: 28, letterSpacing: "-.02em" }}>
          Mẫu màu nhãn “Crewlist đang dùng”
        </h1>
        <p style={{ margin: "8px 0 22px", fontSize: 14, color: "#6b7280" }}>
          Mỗi mẫu hiện trên cả nền sáng và nền tối, đúng như trong tool. Xem xong nhắn lại số mẫu bạn
          thích (ví dụ: <b>2</b>), tôi đổi sang màu đó.
        </p>
        <div style={{ display: "grid", gap: 16 }}>
          {VARIANTS.map((v) => (
            <Sample key={v.n} v={v} />
          ))}
        </div>
      </div>
    </div>
  );
}

export const Route = createFileRoute("/mau-nhan")({
  head: () => ({
    meta: [
      { title: "Mẫu màu nhãn Crewlist — Dispatch Board" },
      {
        name: "description",
        content: "Bảng mẫu màu cho nhãn Crewlist đang dùng trong Dispatch Board.",
      },
      { property: "og:title", content: "Mẫu màu nhãn Crewlist — Dispatch Board" },
      {
        property: "og:description",
        content: "Chọn tông xanh lá cho nhãn Crewlist đang dùng.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: MauNhan,
});
