import { useTheme } from "../lib/theme-context";

export function EyeIcon({ active }: { active: boolean }) {
  const { colors: c } = useTheme();
  const color = active ? c.online : c.muted;
  if (active) {
    return (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
        <circle cx="12" cy="12" r="3"/>
      </svg>
    );
  }
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
      <line x1="1" y1="1" x2="23" y2="23"/>
    </svg>
  );
}

export function MinusIcon() {
  const { colors: c } = useTheme();
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={c.danger} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/>
      <line x1="8" y1="12" x2="16" y2="12"/>
    </svg>
  );
}

export function PlusIcon() {
  const { colors: c } = useTheme();
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={c.accent} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/>
      <line x1="12" y1="8" x2="12" y2="16"/>
      <line x1="8" y1="12" x2="16" y2="12"/>
    </svg>
  );
}

export function SpinnerIcon() {
  const { colors: c } = useTheme();
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={c.accent} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ animation: "mf-spin 1s linear infinite" }}>
      <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
    </svg>
  );
}

export function ChevronIcon({ expanded, size = 18, color }: {
  expanded: boolean;
  size?: number;
  color?: string;
}) {
  const { colors: c } = useTheme();
  const strokeColor = color ?? c.muted;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={strokeColor}
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{
        transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
        transition: "transform 220ms ease",
        flexShrink: 0,
      }}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}
