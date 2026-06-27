// admin-mobile-ui.jsx — mobile chrome: context, header, bottom nav, sheet, atoms
const MCtx = React.createContext(null);
function useM() { return React.useContext(MCtx); }

// translate helpers
function mkT(lang) {
  return { lang, t: (k) => (A[k] ? (A[k][lang] ?? A[k].en) : k), tt: (o) => (o ? (o[lang] ?? o.en ?? '') : '') };
}

// ── screen header (with optional back) ──
function MHeader({ title, sub, onBack, right, big }) {
  return (
    <div style={{ padding: onBack ? '64px 18px 12px' : '66px 18px 10px', background: 'var(--a-cream)', flexShrink: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {onBack && (
          <button onClick={onBack} style={mIconBtn}><Icon name="chevL" size={20} /></button>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          {sub && <div style={{ fontFamily: "'Hanken Grotesk',sans-serif", fontSize: 11.5, fontWeight: 600, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--a-muted)' }}>{sub}</div>}
          <h1 style={{ margin: sub ? '2px 0 0' : 0, fontFamily: "'Schibsted Grotesk','IBM Plex Sans Thai',sans-serif", fontWeight: 600, fontSize: big ? 30 : 25, color: 'var(--a-ink)', letterSpacing: -0.3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</h1>
        </div>
        {right}
      </div>
    </div>
  );
}

const mIconBtn = { width: 40, height: 40, borderRadius: 99, border: '1px solid var(--a-line)', background: 'var(--a-surface-2)', color: 'var(--a-ink-soft)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 };

function MLangToggle() {
  const { lang, setLang } = useM();
  return (
    <div style={{ display: 'flex', border: '1px solid var(--a-line)', borderRadius: 99, overflow: 'hidden', height: 40, background: 'var(--a-surface-2)', flexShrink: 0 }}>
      {['th', 'en'].map((l) => (
        <button key={l} onClick={() => setLang(l)} style={{ padding: '0 12px', border: 'none', cursor: 'pointer', fontFamily: "'Hanken Grotesk',sans-serif", fontSize: 12, fontWeight: 600, letterSpacing: 0.5, textTransform: 'uppercase', background: lang === l ? 'var(--a-ink)' : 'transparent', color: lang === l ? 'var(--a-cream)' : 'var(--a-muted)' }}>{l}</button>
      ))}
    </div>
  );
}

// ── bottom nav with raised center POS ──
const MNAV_L = [{ key: 'today', icon: 'home' }, { key: 'schedule', icon: 'calendar' }];
const MNAV_R = [{ key: 'customers', icon: 'users' }, { key: 'more', icon: 'filter' }];

function MBottomNav() {
  const { tab, go, t } = useM();
  const item = (n) => {
    const on = tab === n.key;
    return (
      <button key={n.key} onClick={() => go(n.key)} style={{ flex: 1, border: 'none', background: 'none', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, color: on ? 'var(--a-ink)' : 'var(--a-muted)', padding: '4px 0' }}>
        <Icon name={n.icon} size={23} stroke={on ? 1.9 : 1.5} />
        <span style={{ fontFamily: "'Hanken Grotesk',sans-serif", fontSize: 10, fontWeight: on ? 600 : 500 }}>{t(n.key)}</span>
      </button>
    );
  };
  return (
    <div style={{ flexShrink: 0, position: 'relative', display: 'flex', alignItems: 'flex-start', padding: '10px 10px 26px', background: 'var(--a-surface-2)', borderTop: '1px solid var(--a-line)', boxShadow: '0 -8px 24px rgba(72,58,40,0.05)' }}>
      {MNAV_L.map(item)}
      {/* center POS */}
      <div style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
        <button onClick={() => go('pos')} style={{ position: 'relative', top: -22, width: 62, height: 62, borderRadius: 99, border: '4px solid var(--a-surface-2)', background: tab === 'pos' ? 'var(--a-taupe)' : 'var(--a-ink)', color: '#fff', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1, boxShadow: '0 8px 22px rgba(46,40,32,0.32)' }}>
          <Icon name="qr" size={23} stroke={1.7} />
          <span style={{ fontFamily: "'Hanken Grotesk',sans-serif", fontSize: 8.5, fontWeight: 700, letterSpacing: 0.5 }}>POS</span>
        </button>
      </div>
      {MNAV_R.map(item)}
    </div>
  );
}

// ── bottom sheet ──
function MSheet({ open, onClose, children, maxH = '90%' }) {
  const [render, setRender] = React.useState(open);
  const [show, setShow] = React.useState(false);
  React.useEffect(() => {
    if (open) { setRender(true); requestAnimationFrame(() => requestAnimationFrame(() => setShow(true))); }
    else { setShow(false); const tm = setTimeout(() => setRender(false), 300); return () => clearTimeout(tm); }
  }, [open]);
  if (!render) return null;
  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 200, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(40,32,24,0.34)', opacity: show ? 1 : 0, transition: 'opacity .3s', backdropFilter: 'blur(2px)' }} />
      <div style={{ position: 'relative', background: 'var(--a-surface)', borderRadius: '28px 28px 0 0', maxHeight: maxH, display: 'flex', flexDirection: 'column', overflow: 'hidden', transform: show ? 'translateY(0)' : 'translateY(101%)', transition: 'transform .34s cubic-bezier(.32,.72,0,1)', boxShadow: '0 -20px 60px rgba(40,32,24,0.25)' }}>
        <div style={{ display: 'flex', justifyContent: 'center', padding: '12px 0 4px', flexShrink: 0 }}>
          <div style={{ width: 40, height: 5, borderRadius: 99, background: 'var(--a-line-strong)' }} />
        </div>
        <div style={{ overflowY: 'auto', padding: '6px 20px 26px' }}>{children}</div>
      </div>
    </div>
  );
}

// ── atoms ──
function MStat({ label, value, sub, accent }) {
  return (
    <div style={{ background: 'var(--a-surface-2)', border: '1px solid var(--a-line)', borderRadius: 16, padding: '13px 14px', boxShadow: 'var(--a-shadow)', minWidth: 0 }}>
      <div style={{ fontFamily: "'Hanken Grotesk',sans-serif", fontSize: 10.5, fontWeight: 600, letterSpacing: 0.5, textTransform: 'uppercase', color: 'var(--a-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 5, marginTop: 5 }}>
        <span style={{ fontFamily: "'Schibsted Grotesk',sans-serif", fontWeight: 700, fontSize: 26, color: accent || 'var(--a-ink)', lineHeight: 1 }}>{value}</span>
        {sub && <span style={{ fontFamily: "'Hanken Grotesk',sans-serif", fontSize: 12, color: 'var(--a-muted)' }}>{sub}</span>}
      </div>
    </div>
  );
}

function Eyebrow2({ children, style = {} }) {
  return <div style={{ fontFamily: "'Hanken Grotesk',sans-serif", fontSize: 11, fontWeight: 600, letterSpacing: 0.8, textTransform: 'uppercase', color: 'var(--a-muted)', ...style }}>{children}</div>;
}

function MPrimary({ children, onClick, icon, disabled, tone }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{ width: '100%', height: 54, borderRadius: 15, cursor: disabled ? 'default' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9, border: 'none', fontFamily: "'Hanken Grotesk',sans-serif", fontSize: 16, fontWeight: 600, background: disabled ? 'var(--a-cream-2)' : tone === 'sage' ? 'var(--a-sage)' : 'var(--a-ink)', color: disabled ? 'var(--a-muted)' : '#fff', boxShadow: disabled ? 'none' : '0 6px 18px rgba(46,40,32,0.18)' }}>
      {children}{icon && <Icon name={icon} size={19} />}
    </button>
  );
}

function endTM(time, dur) { let [h, m] = time.split(':').map(Number); m += dur; h += Math.floor(m / 60); m %= 60; return String(h).padStart(2,'0') + ':' + String(m).padStart(2,'0'); }

Object.assign(window, { MCtx, useM, mkT, MHeader, mIconBtn, MLangToggle, MBottomNav, MSheet, MStat, Eyebrow2, MPrimary, endTM });
