import { useState } from "react";

export function Avatar({ name, src }: { name: string; src?: string }) {
  const [error, setError] = useState(false);
  const showImage = src && !error;

  if (showImage) {
    return (
      <img
        src={src}
        alt=""
        onError={() => setError(true)}
        style={{
          width: 38, height: 38, borderRadius: "50%", objectFit: "cover", flexShrink: 0,
        }}
      />
    );
  }

  const initials = name
    .replace(/^[@#]/, "")
    .split(/[\s_]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() || "")
    .join("");

  let hash = 0;
  for (let i = 0; i < name.length; i++)
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  const hue = hash % 360;
  const bg = `hsl(${hue}, 55%, 78%)`;
  const fg = `hsl(${hue}, 50%, 28%)`;

  return (
    <div style={{
      width: 38, height: 38, borderRadius: "50%", background: bg, color: fg,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontWeight: 600, fontSize: 13, flexShrink: 0,
    }}>
      {initials || "·"}
    </div>
  );
}
