# MeshyNet Design System

Tento dokument popisuje vizuálnu identitu MeshyNet značky. Používa sa na landing page (`meshynet.com`), success/cancel/account stránkach a v MeshyNet desktop appke.

**Cieľ pri implementácii v appke:** Appka musí vyzerať vizuálne **identicky** s landing page — rovnaké farby, rovnaké fonty, rovnaké gradienty. Toto je hlavná značková kontinuita medzi webom a aplikáciou.

---

## 1. Farby

### Brand gradient (NIKDY nemeniť)

Tento gradient je značkou MeshyNet. Používa sa na:
- Logo
- Klíčové headings (akcentová časť)
- Primary CTA buttons
- Tier badges (STANDARD PLÁN)
- Network buttons na IndexView

```css
/* CSS gradient string */
linear-gradient(110deg, #4061ad 0%, #6059a7 45%, #2fbebe 100%)
```

```typescript
const BRAND_GRADIENT = {
  start: "#4061ad",   // Modrá
  mid: "#6059a7",     // Fialová
  end: "#2fbebe",     // Tyrkysová
  cssString: "linear-gradient(110deg, #4061ad 0%, #6059a7 45%, #2fbebe 100%)",
};
```

### Dark mode (default v appke)

```typescript
const DARK_COLORS = {
  // Base
  bg: "#000000",                          // Pure black background
  bgElevated: "#0a0a0a",                  // Cards, modals, panels
  bgHover: "rgba(255, 255, 255, 0.04)",   // Hover na rows/buttons
  
  // Text
  fg: "#ffffff",                          // Primary text (biele headings, body)
  fgSecondary: "rgba(255, 255, 255, 0.85)", // Slightly muted text
  muted: "rgba(255, 255, 255, 0.55)",     // Captions, hints, timestamps
  
  // Borders
  border: "rgba(255, 255, 255, 0.10)",    // Subtle 0.5px lines (cards)
  borderStrong: "rgba(255, 255, 255, 0.18)", // Visible dividers
  
  // Accent
  accent: "#2fbebe",                      // Solid tyrkysová pre linky/secondary CTA
  
  // Status colors
  online: "#30d158",
  warning: "#ff9f0a",                     // Cancel banner background tint
  danger: "#ff453a",                      // Remove buttons
  
  // Inputs
  inputBg: "rgba(255, 255, 255, 0.04)",
  inputBorder: "rgba(255, 255, 255, 0.12)",
  
  // Shadows
  shadow: "0 8px 32px rgba(0, 0, 0, 0.6)",
};
```

### Light mode (toggle option)

```typescript
const LIGHT_COLORS = {
  bg: "#f5f5f7",                          // Apple-style off-white
  bgElevated: "#ffffff",
  bgHover: "#fafafa",
  fg: "#1d1d1f",                          // Apple-style dark grey
  fgSecondary: "#3a3a3c",
  muted: "#86868b",
  border: "rgba(0, 0, 0, 0.08)",
  borderStrong: "rgba(0, 0, 0, 0.15)",
  accent: "#0071e3",                      // Apple-style blue v light mode
  online: "#30b04a",
  warning: "#ff9500",
  danger: "#ff3b30",
  inputBg: "#ffffff",
  inputBorder: "#d2d2d7",
  shadow: "0 8px 32px rgba(0, 0, 0, 0.08)",
};
```

---

## 2. Typografia

### Fonty

**Fraunces** (Google Font) — Pre key headings, najmä split-style nadpisy
```html
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,500;0,9..144,600;0,9..144,700;1,9..144,500;1,9..144,600&display=swap" rel="stylesheet">
```

CSS použitie:
```css
font-family: 'Fraunces', Georgia, serif;
font-optical-sizing: auto;
font-variation-settings: "opsz" 144;
```

**Manrope** (Google Font) — Pre body text, UI labels, buttons
```html
<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700&display=swap" rel="stylesheet">
```

CSS použitie:
```css
font-family: 'Manrope', -apple-system, BlinkMacSystemFont, sans-serif;
```

### Hierarchia veľkostí

```typescript
const TYPOGRAPHY = {
  // Hero/page titles (landing-style)
  h1: {
    fontFamily: "'Fraunces', Georgia, serif",
    fontSize: "clamp(42px, 7vw, 68px)",
    fontWeight: 600,
    letterSpacing: "-0.025em",
    lineHeight: 1.05,
  },
  
  // Section titles, modal headings
  h2: {
    fontFamily: "'Manrope', sans-serif",
    fontSize: "clamp(28px, 4vw, 36px)",
    fontWeight: 700,
    letterSpacing: "-0.02em",
    lineHeight: 1.2,
  },
  
  // App title "Master feed" v appke (split style)
  appTitle: {
    fontFamily: "'Manrope', sans-serif",
    fontSize: 32,
    fontWeight: 700,
    letterSpacing: "-0.02em",
    // "Master" - biely, "feed" - Fraunces italic gradient
  },
  
  // Body text
  body: {
    fontFamily: "'Manrope', sans-serif",
    fontSize: 15,
    fontWeight: 400,
    lineHeight: 1.5,
  },
  
  // Small UI text (timestamps, captions)
  caption: {
    fontFamily: "'Manrope', sans-serif",
    fontSize: 13,
    fontWeight: 500,
  },
};
```

### Split-heading pattern (key pre značku)

Toto je **signature MeshyNet pattern** — väčšina nadpisov je rozdelená na 2 časti:
- **Prvá časť:** Manrope, regular weight, biela/foreground farba
- **Druhá časť:** Fraunces, italic, gradient (BRAND_GRADIENT)

Príklady:
- Landing: "Meshy**Net**" — Meshy v Manrope, Net v Fraunces italic gradient
- Account page: "Späť v **MeshyNet**"
- Appka: "Master **feed**" — Master v Manrope biele, feed v Fraunces italic gradient

JSX/TSX príklad:
```tsx
<h1 style={{
  fontFamily: "'Manrope', sans-serif",
  fontSize: 32,
  fontWeight: 700,
  color: c.fg, // biela v dark mode
}}>
  Master{" "}
  <span style={{
    fontFamily: "'Fraunces', serif",
    fontStyle: "italic",
    fontWeight: 600,
    background: "linear-gradient(110deg, #4061ad 0%, #6059a7 45%, #2fbebe 100%)",
    WebkitBackgroundClip: "text",
    backgroundClip: "text",
    color: "transparent",
  }}>
    feed
  </span>
</h1>
```

---

## 3. Ambient Background Glow

**Charakteristika landing/legal page**, dodáva atmosféru:

```css
body::before {
  content: '';
  position: fixed;
  top: -200px;
  left: 50%;
  transform: translateX(-50%);
  width: 800px;
  height: 800px;
  background: radial-gradient(circle, rgba(47, 190, 190, 0.08) 0%, transparent 60%);
  pointer-events: none;
  z-index: 0;
}
```

V appke môže byť subtílnejšie (napr. iba na IndexView a UpgradeModal background).

---

## 4. Animácie

### Fade-up (key entrance)

```css
@keyframes fadeUp {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}

.element {
  animation: fadeUp 0.6s 0.2s cubic-bezier(0.2, 0.8, 0.2, 1) both;
}
```

### Scale-in (icons, badges)

```css
@keyframes scaleIn {
  from { opacity: 0; transform: scale(0.7); }
  to { opacity: 1; transform: scale(1); }
}
```

### Theme transition

Pri prepnutí dark/light mode má prechod trvať **200ms ease**:
```css
body {
  transition: background 200ms ease, color 200ms ease;
}
```

---

## 5. Buttons

### Primary CTA (gradient)

```css
.btn-primary {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 15px 32px;
  font-family: 'Manrope', sans-serif;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.01em;
  border-radius: 999px;
  cursor: pointer;
  transition: transform 0.2s, box-shadow 0.2s, filter 0.2s;
  border: none;
  color: #ffffff;
  background: linear-gradient(110deg, #4061ad 0%, #6059a7 45%, #2fbebe 100%);
  box-shadow: 0 6px 24px rgba(47, 190, 190, 0.25);
}

.btn-primary:hover {
  transform: translateY(-1px);
  filter: brightness(1.08);
  box-shadow: 0 10px 32px rgba(47, 190, 190, 0.4);
}
```

### Secondary CTA (ghost)

```css
.btn-secondary {
  background: transparent;
  border: 1px solid var(--border);
  color: var(--fg);
  padding: 14px 28px;
  border-radius: 999px;
  /* ... */
}
```

---

## 6. Cards & Containers

```css
.card {
  background: var(--bg-elevated);
  border: 0.5px solid var(--border);
  border-radius: 14px;
  padding: 20px;
}
```

Border-radius scale:
- **8px** — buttons, small inputs
- **10px** — banners, alerts
- **14px** — cards, panels
- **20px** — modals
- **999px** — pill buttons

---

## 7. Spacing scale

Apple-style spacing, 4px base:

```typescript
const SPACING = {
  xs: 4,
  sm: 8,
  md: 12,
  base: 16,
  lg: 20,
  xl: 24,
  xxl: 32,
  xxxl: 48,
  hero: 64,
};
```

---

## 8. Konkrétne pre MeshyNet appku

### IndexView (network picker)

- **Pozadie:** čierne (`#000000`)
- **Ambient glow:** subtílne tyrkysové v hornej časti
- **MeshyNet logo:** centrovaný hore, ~120px width
- **Hlavný nadpis:** "Master **feed**" (split style, Master biele Manrope, feed Fraunces italic gradient)
- **Subline:** Manrope 15px, muted color
- **Network buttons:** Veľké pill buttons s gradient background (Facebook, Instagram, YouTube)
- **Spacing:** Hero spacing medzi sekciami

### Master Feed View

- **Pozadie:** čierne (`#000000`) v dark mode
- **Header:** "Master **feed**" split style
- **Status bar:** Card s elevated background, 0.5px border
- **Posts:** Cards s elevated background, čitateľné v dark mode
  - **Text:** Biely Manrope (`--fg`)
  - **Timestamps:** muted (`--muted`)
  - **Author:** medium weight
  - **Images:** rounded corners (14px)
- **Filter panel:** rovnaký card style

### UserMenu

- **Dropdown:** Elevated background, subtle shadow
- **Email:** muted color, Manrope 13px
- **Tier badge:** Gradient text (Fraunces italic alebo Manrope bold)
  - "STANDARD PLÁN" — gradient
  - "FREE PLÁN" — muted bez gradientu
- **Položky:** Manrope 14px, hover bgHover

### Cancel Banner

- **Background:** `rgba(255, 159, 10, 0.06)` (warning tint v dark mode)
- **Border:** `0.5px solid rgba(255, 159, 10, 0.25)`
- **Dot:** 6px round, warning color
- **Text:** "Standard plán končí 15. júna 2026" (Manrope)
- **CTA "Obnoviť":** Accent color, no background

### Settings Modal (nová pre dark mode)

- **Backdrop:** `rgba(0, 0, 0, 0.6)` blur
- **Modal:** Card style, bg-elevated, border-radius 20px
- **Title:** "Nastavenia" (h2 style)
- **Sekcia "Vzhľad":** Toggle s 🌙/☀️ ikonami
- **Sekcia "Jazyk":** Dropdown s 24 jazykmi (flag emoji + display name)

---

## 9. Implementačné poznámky

1. **CSS premenné cez data-theme atribút:**
   ```css
   [data-theme="dark"] { --bg: #000000; --fg: #ffffff; /* ... */ }
   [data-theme="light"] { --bg: #f5f5f7; --fg: #1d1d1f; /* ... */ }
   ```

2. **Brand gradient sa NEMENÍ medzi modes** — identický v dark aj light. To je značka.

3. **Fonty preload:** Načítaj Fraunces + Manrope cez Google Fonts CSS v `index.html` head.

4. **Transition:** Všetky color zmeny majú 200ms ease transition.

5. **Test:** Po prepnutí na light mode musí ostať brand gradient identický, len base background/foreground sa zmení.
