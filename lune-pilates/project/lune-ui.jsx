// lune-ui.jsx — theme, context, and shared chrome components
const { createContext, useContext, useState, useEffect, useRef } = React;

// ───────── context: language, credits, navigation, sheets ─────────
const LuneCtx = createContext(null);
function useLune() { return useContext(LuneCtx); }

// translate helpers built from a lang code
function makeT(lang) {
  return {
    lang,
    t: (key) => (STR[key] ? (STR[key][lang] ?? STR[key].en) : key),
    tt: (obj) => (obj ? (obj[lang] ?? obj.en ?? '') : ''),
  };
}

// ───────── theme: derive CSS vars from tweaks ─────────
function themeVars(tw) {
  const warm = (tw.colorTemp || 'warm') === 'warm';
  const cream   = warm ? '#F1E9E0' : '#ECE7E1';
  const cream2  = warm ? '#E9DECF' : '#E2DBD2';
  const surface = warm ? '#FBF6EF' : '#FAF8F4';
  const surface2= warm ? '#FFFCF7' : '#FFFFFF';
  const ink     = warm ? '#2E2820' : '#2A2824';
  const inkSoft = warm ? '#6B5D4C' : '#62584C';
  const muted   = warm ? '#9C8C77' : '#988E80';
  const taupe   = tw.accent || '#8C7A63';
  const radiusMap = { soft: 30, rounded: 22, sharp: 14 };
  const r = radiusMap[tw.radius || 'soft'];
  const densMap = { airy: 1.18, regular: 1, compact: 0.84 };
  const dens = densMap[tw.density || 'regular'];
  const fontMap = {
    Schibsted: "'Schibsted Grotesk', 'IBM Plex Sans Thai', system-ui, sans-serif",
    Hanken:    "'Hanken Grotesk', 'IBM Plex Sans Thai', system-ui, sans-serif",
    Cormorant: "'Cormorant Garamond', 'Trirong', Georgia, serif",
    Fraunces:  "'Fraunces', 'Trirong', Georgia, serif",
    Playfair:  "'Playfair Display', 'Trirong', Georgia, serif",
  };
  return {
    '--cream': cream, '--cream-2': cream2,
    '--surface': surface, '--surface-2': surface2,
    '--ink': ink, '--ink-soft': inkSoft, '--muted': muted,
    '--line': 'rgba(140,122,99,0.16)',
    '--line-strong': 'rgba(140,122,99,0.3)',
    '--taupe': taupe, '--taupe-deep': '#6E5E49',
    '--sage': '#8C9A7E', '--sage-deep': '#6E7C60',
    '--rose': '#C49A86',
    '--radius': r + 'px', '--radius-sm': Math.round(r * 0.55) + 'px',
    '--gap': dens,
    '--shadow-sm': '0 1px 2px rgba(72,58,40,0.04), 0 4px 14px rgba(72,58,40,0.05)',
    '--shadow-md': '0 4px 14px rgba(72,58,40,0.06), 0 18px 40px rgba(72,58,40,0.09)',
    '--font-head': fontMap[tw.headingFont || 'Schibsted'],
    '--font-brand': "'Cormorant Garamond', 'Trirong', Georgia, serif",
    '--font-body': "'Hanken Grotesk', 'IBM Plex Sans Thai', system-ui, sans-serif",
  };
}

// ───────── session helpers ─────────
function typeOf(s) { return TYPES[s.type]; }
function capOf(s) { return TYPES[s.type].cap; }
function spotsLeft(s) { return capOf(s) - s.booked; }
function isFull(s) { return spotsLeft(s) <= 0; }
function partOfDay(time) {
  const h = parseInt(time.slice(0, 2), 10);
  return h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
}

// ───────── small atoms ─────────
function TypeDot({ type, size = 8 }) {
  return <span style={{ width: size, height: size, borderRadius: 99, background: TYPES[type].dot, display: 'inline-block', flexShrink: 0 }} />;
}

function Chip({ active, children, onClick, dot }) {
  return (
    <button onClick={onClick} style={{
      display: 'inline-flex', alignItems: 'center', gap: 7, whiteSpace: 'nowrap',
      padding: '9px 15px', borderRadius: 99, cursor: 'pointer',
      fontFamily: 'var(--font-body)', fontSize: 13.5, fontWeight: 500, letterSpacing: 0.1,
      border: '1px solid ' + (active ? 'transparent' : 'var(--line-strong)'),
      background: active ? 'var(--ink)' : 'transparent',
      color: active ? 'var(--cream)' : 'var(--ink-soft)',
      transition: 'all .2s ease',
    }}>
      {dot && <TypeDot type={dot} size={7} />}
      {children}
    </button>
  );
}

function PrimaryButton({ children, onClick, disabled, icon, variant = 'solid' }) {
  const solid = variant === 'solid';
  return (
    <button onClick={onClick} disabled={disabled} style={{
      width: '100%', height: 56, borderRadius: 'var(--radius-sm)', cursor: disabled ? 'default' : 'pointer',
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9,
      fontFamily: 'var(--font-body)', fontSize: 16, fontWeight: 600, letterSpacing: 0.2,
      border: solid ? 'none' : '1.5px solid var(--line-strong)',
      background: disabled ? 'var(--cream-2)' : solid ? 'var(--ink)' : 'transparent',
      color: disabled ? 'var(--muted)' : solid ? 'var(--cream)' : 'var(--ink)',
      boxShadow: solid && !disabled ? '0 6px 20px rgba(46,40,32,0.18)' : 'none',
      transition: 'transform .12s ease, opacity .2s',
    }}
    onMouseDown={(e) => { if (!disabled) e.currentTarget.style.transform = 'scale(0.985)'; }}
    onMouseUp={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}
    onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}>
      {children}{icon && <Icon name={icon} size={19} />}
    </button>
  );
}

// ───────── header ─────────
function Header({ onLang }) {
  const { lang } = useLune();
  return (
    <div style={{
      padding: '54px 22px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      background: 'var(--cream)', flexShrink: 0,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <BrandLockup />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <LangToggle />
        <button style={iconBtnStyle}><Icon name="bell" size={20} /></button>
      </div>
    </div>
  );
}

const iconBtnStyle = {
  width: 40, height: 40, borderRadius: 99, border: '1px solid var(--line)',
  background: 'var(--surface-2)', color: 'var(--ink-soft)', cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
};

function BrandLockup({ scale = 1 }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
      <span style={{
        fontFamily: 'var(--font-brand)', fontWeight: 600, fontSize: 26 * scale,
        letterSpacing: 5 * scale, color: 'var(--taupe-deep)', lineHeight: 1,
      }}>LUN<span style={{ position: 'relative' }}>E<Sparkle size={7 * scale} color="var(--taupe)" style={{ position: 'absolute', top: 2 * scale, right: -2 * scale }} /></span></span>
    </div>
  );
}

function LangToggle() {
  const { lang, setLang } = useLune();
  return (
    <div style={{
      display: 'flex', border: '1px solid var(--line)', borderRadius: 99,
      background: 'var(--surface-2)', overflow: 'hidden', height: 40,
    }}>
      {['th', 'en'].map((l) => (
        <button key={l} onClick={() => setLang(l)} style={{
          padding: '0 13px', border: 'none', cursor: 'pointer', fontFamily: 'var(--font-body)',
          fontSize: 12.5, fontWeight: 600, letterSpacing: 0.5, textTransform: 'uppercase',
          background: lang === l ? 'var(--ink)' : 'transparent',
          color: lang === l ? 'var(--cream)' : 'var(--muted)', transition: 'all .2s',
        }}>{l}</button>
      ))}
    </div>
  );
}

// ───────── bottom nav ─────────
function BottomNav() {
  const { screen, go, t } = useLune();
  const items = [
    { key: 'home', icon: 'home', label: t('nav_home') },
    { key: 'schedule', icon: 'calendar', label: t('nav_schedule') },
    { key: 'bookings', icon: 'bookings', label: t('nav_bookings') },
    { key: 'profile', icon: 'profile', label: t('nav_profile') },
  ];
  const activeTab = ['home', 'schedule', 'bookings', 'profile'].includes(screen) ? screen
    : (screen === 'detail' ? 'schedule' : screen === 'credits' ? 'home' : 'home');
  return (
    <div style={{
      flexShrink: 0, display: 'flex', justifyContent: 'space-around', alignItems: 'flex-start',
      padding: '10px 8px 26px', background: 'var(--surface-2)',
      borderTop: '1px solid var(--line)', boxShadow: '0 -8px 24px rgba(72,58,40,0.04)',
    }}>
      {items.map((it) => {
        const on = activeTab === it.key;
        return (
          <button key={it.key} onClick={() => go(it.key)} style={{
            border: 'none', background: 'none', cursor: 'pointer', flex: 1,
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
            color: on ? 'var(--ink)' : 'var(--muted)', transition: 'color .2s',
          }}>
            <Icon name={it.icon} size={23} stroke={on ? 1.8 : 1.5} />
            <span style={{ fontFamily: 'var(--font-body)', fontSize: 10.5, fontWeight: on ? 600 : 500, letterSpacing: 0.2 }}>{it.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// ───────── bottom sheet ─────────
function Sheet({ open, onClose, children, maxH = '88%' }) {
  const [render, setRender] = useState(open);
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (open) { setRender(true); requestAnimationFrame(() => requestAnimationFrame(() => setShow(true))); }
    else { setShow(false); const tm = setTimeout(() => setRender(false), 300); return () => clearTimeout(tm); }
  }, [open]);
  if (!render) return null;
  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 200, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
      <div onClick={onClose} style={{
        position: 'absolute', inset: 0, background: 'rgba(40,32,24,0.34)',
        opacity: show ? 1 : 0, transition: 'opacity .3s ease', backdropFilter: 'blur(2px)',
      }} />
      <div style={{
        position: 'relative', background: 'var(--surface)', borderRadius: '30px 30px 0 0',
        maxHeight: maxH, display: 'flex', flexDirection: 'column', overflow: 'hidden',
        transform: show ? 'translateY(0)' : 'translateY(101%)',
        transition: 'transform .34s cubic-bezier(.32,.72,0,1)',
        boxShadow: '0 -20px 60px rgba(40,32,24,0.25)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'center', padding: '12px 0 4px', flexShrink: 0 }}>
          <div style={{ width: 40, height: 5, borderRadius: 99, background: 'var(--line-strong)' }} />
        </div>
        <div style={{ overflowY: 'auto', padding: '8px 22px 30px' }}>{children}</div>
      </div>
    </div>
  );
}

// section label (small caps eyebrow)
function Eyebrow({ children, style = {} }) {
  return <div style={{
    fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 600, letterSpacing: 1.6,
    textTransform: 'uppercase', color: 'var(--muted)', ...style,
  }}>{children}</div>;
}

Object.assign(window, {
  LuneCtx, useLune, makeT, themeVars,
  typeOf, capOf, spotsLeft, isFull, partOfDay,
  TypeDot, Chip, PrimaryButton, Header, BrandLockup, LangToggle, BottomNav, Sheet, Eyebrow, iconBtnStyle,
});
