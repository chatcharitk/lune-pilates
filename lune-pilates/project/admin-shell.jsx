// admin-shell.jsx — context, responsive chrome, shared primitives
const { createContext, useContext, useState, useEffect, useRef } = React;
const AdminCtx = createContext(null);
function useAdmin() { return useContext(AdminCtx); }

const NAV = [
  { key: 'today', icon: 'home' },
  { key: 'schedule', icon: 'calendar' },
  { key: 'bookings', icon: 'bookings' },
  { key: 'members', icon: 'users' },
  { key: 'payments', icon: 'qr' },
  { key: 'instructors', icon: 'profile' },
];

function aT(obj, lang) { return obj ? (obj[lang] ?? obj.en) : ''; }

// ───────── brand lockup ─────────
function AdminBrand({ light }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <span style={{ fontFamily: "'Cormorant Garamond', serif", fontWeight: 600, fontSize: 25, letterSpacing: 4, color: light ? '#F1E9E0' : 'var(--a-taupe-deep)', lineHeight: 1 }}>
        LUN<span style={{ position: 'relative' }}>E<svg width="7" height="7" viewBox="0 0 24 24" style={{ position: 'absolute', top: 1, right: -3 }}><path d="M12 1.5c.5 6 4 9.5 10 10-6 .5-9.5 4-10 10-.5-6-4-9.5-10-10 6-.5 9.5-4 10-10Z" fill={light ? '#C9B89E' : 'var(--a-taupe)'} /></svg></span>
      </span>
      <span style={{ fontFamily: "'Hanken Grotesk', sans-serif", fontSize: 9, fontWeight: 600, letterSpacing: 2.5, textTransform: 'uppercase', color: light ? 'rgba(241,233,224,0.5)' : 'var(--a-muted)', paddingLeft: 10, borderLeft: '1px solid ' + (light ? 'rgba(241,233,224,0.2)' : 'var(--a-line)') }}>Admin</span>
    </div>
  );
}

// ───────── sidebar (desktop / tablet) ─────────
function Sidebar() {
  const { screen, go, lang } = useAdmin();
  return (
    <aside className="admin-sidebar">
      <div style={{ padding: '26px 22px 22px' }}><AdminBrand light /></div>
      <nav style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '6px 14px', flex: 1 }}>
        {NAV.map((n) => {
          const on = screen === n.key;
          return (
            <button key={n.key} onClick={() => go(n.key)} className="admin-navitem" style={{
              display: 'flex', alignItems: 'center', gap: 13, padding: '12px 14px', borderRadius: 13, border: 'none', cursor: 'pointer',
              background: on ? 'rgba(241,233,224,0.12)' : 'transparent',
              color: on ? '#F6EFE6' : 'rgba(241,233,224,0.62)',
              fontFamily: "'Hanken Grotesk', sans-serif", fontSize: 14.5, fontWeight: on ? 600 : 500, transition: 'all .18s', textAlign: 'left',
            }}>
              <Icon name={n.icon} size={20} stroke={on ? 1.9 : 1.6} />
              <span className="admin-navlabel">{aT(A[n.key], lang)}</span>
              {on && <span style={{ marginLeft: 'auto', width: 6, height: 6, borderRadius: 99, background: '#C9B89E' }} className="admin-navlabel" />}
            </button>
          );
        })}
      </nav>
      <div style={{ padding: '14px', borderTop: '1px solid rgba(241,233,224,0.12)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
          <div style={{ width: 38, height: 38, borderRadius: 99, background: 'rgba(241,233,224,0.16)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#F1E9E0', fontFamily: "'Hanken Grotesk', sans-serif", fontWeight: 700, fontSize: 14, flexShrink: 0 }}>ก</div>
          <div className="admin-navlabel" style={{ minWidth: 0 }}>
            <div style={{ fontFamily: "'Hanken Grotesk', sans-serif", fontSize: 13, fontWeight: 600, color: '#F1E9E0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{lang === 'th' ? 'ครูใหม่' : 'Kru Mai'}</div>
            <div style={{ fontFamily: "'Hanken Grotesk', sans-serif", fontSize: 11, color: 'rgba(241,233,224,0.5)' }}>{aT(A.greeting_admin, lang)}</div>
          </div>
        </div>
      </div>
    </aside>
  );
}

// ───────── mobile bottom nav ─────────
function MobileNav() {
  const { screen, go, lang } = useAdmin();
  return (
    <nav className="admin-mobilenav">
      {NAV.slice(0, 5).map((n) => {
        const on = screen === n.key;
        return (
          <button key={n.key} onClick={() => go(n.key)} style={{
            flex: 1, border: 'none', background: 'none', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
            color: on ? 'var(--a-ink)' : 'var(--a-muted)', padding: '2px',
          }}>
            <Icon name={n.icon} size={22} stroke={on ? 1.9 : 1.5} />
            <span style={{ fontFamily: "'Hanken Grotesk', sans-serif", fontSize: 10, fontWeight: on ? 600 : 500 }}>{aT(A[n.key], lang)}</span>
          </button>
        );
      })}
    </nav>
  );
}

// ───────── topbar ─────────
function Topbar() {
  const { lang, setLang } = useAdmin();
  return (
    <header className="admin-topbar">
      <div className="admin-topbar-brand"><AdminBrand /></div>
      <div style={{ minWidth: 0, flex: 1 }} className="admin-hide-sm">
        <div style={{ fontFamily: "'Hanken Grotesk', sans-serif", fontSize: 12, fontWeight: 600, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--a-muted)' }}>{aT(A.today_long, lang)}</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0, marginLeft: 'auto' }}>
        <button style={{ width: 38, height: 38, borderRadius: 99, border: '1px solid var(--a-line)', background: 'var(--a-surface-2)', color: 'var(--a-ink-soft)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="bell" size={19} /></button>
        <div style={{ display: 'flex', border: '1px solid var(--a-line)', borderRadius: 99, overflow: 'hidden', height: 38, background: 'var(--a-surface-2)' }}>
          {['th', 'en'].map((l) => (
            <button key={l} onClick={() => setLang(l)} style={{ padding: '0 12px', border: 'none', cursor: 'pointer', fontFamily: "'Hanken Grotesk', sans-serif", fontSize: 12, fontWeight: 600, letterSpacing: 0.5, textTransform: 'uppercase', background: lang === l ? 'var(--a-ink)' : 'transparent', color: lang === l ? 'var(--a-cream)' : 'var(--a-muted)' }}>{l}</button>
          ))}
        </div>
      </div>
    </header>
  );
}

// ───────── primitives ─────────
function Card({ children, style = {}, pad = 18, onClick, hover }) {
  return (
    <div onClick={onClick} style={{
      background: 'var(--a-surface-2)', border: '1px solid var(--a-line)', borderRadius: 18,
      padding: pad, boxShadow: 'var(--a-shadow)', cursor: onClick ? 'pointer' : 'default', ...style,
    }}>{children}</div>
  );
}

function Stat({ label, value, sub, accent }) {
  return (
    <Card pad={16} style={{ minWidth: 0 }}>
      <div style={{ fontFamily: "'Hanken Grotesk', sans-serif", fontSize: 11.5, fontWeight: 600, letterSpacing: 0.6, textTransform: 'uppercase', color: 'var(--a-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 6 }}>
        <span style={{ fontFamily: "'Schibsted Grotesk', sans-serif", fontWeight: 700, fontSize: 30, color: accent || 'var(--a-ink)', lineHeight: 1 }}>{value}</span>
        {sub && <span style={{ fontFamily: "'Hanken Grotesk', sans-serif", fontSize: 13, color: 'var(--a-muted)' }}>{sub}</span>}
      </div>
    </Card>
  );
}

function Badge({ children, tone = 'neutral' }) {
  const map = {
    neutral: ['var(--a-cream-2)', 'var(--a-ink-soft)'],
    green: ['rgba(140,154,126,0.16)', 'var(--a-sage-deep)'],
    amber: ['rgba(193,160,121,0.18)', '#9A7B45'],
    rose: ['rgba(196,154,134,0.16)', '#A56A52'],
    ink: ['var(--a-ink)', 'var(--a-cream)'],
  };
  const [bg, fg] = map[tone] || map.neutral;
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 99, background: bg, color: fg, fontFamily: "'Hanken Grotesk', sans-serif", fontSize: 11.5, fontWeight: 600, letterSpacing: 0.2, whiteSpace: 'nowrap' }}>{children}</span>;
}

function Dot({ type, size = 8 }) {
  return <span style={{ width: size, height: size, borderRadius: 99, background: ATYPES[type].dot, display: 'inline-block', flexShrink: 0 }} />;
}

function Avatar({ id, size = 34 }) {
  const m = typeof id === 'string' && AINSTR[id] ? AINSTR[id] : null;
  const member = !m ? mem(id) : null;
  const initials = m ? m.initials : (member ? aT(member.name, 'en').trim().slice(0, 1) : '?');
  const color = m ? m.color : 'var(--a-taupe)';
  return <div style={{ width: size, height: size, borderRadius: 99, flexShrink: 0, background: color, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Hanken Grotesk', sans-serif", fontWeight: 700, fontSize: size * 0.4 }}>{initials}</div>;
}

function CapBar({ booked, cap }) {
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      {Array.from({ length: cap }).map((_, i) => (
        <div key={i} style={{ flex: 1, height: 6, borderRadius: 99, background: i < booked ? 'var(--a-taupe)' : 'var(--a-cream-2)' }} />
      ))}
    </div>
  );
}

function PageTitle({ children, sub }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <h2 style={{ margin: 0, fontFamily: "'Schibsted Grotesk','IBM Plex Sans Thai',sans-serif", fontWeight: 600, fontSize: 24, color: 'var(--a-ink)', letterSpacing: -0.3 }}>{children}</h2>
      {sub && <p style={{ margin: '5px 0 0', fontFamily: "'Hanken Grotesk', sans-serif", fontSize: 13.5, color: 'var(--a-muted)' }}>{sub}</p>}
    </div>
  );
}

function Btn({ children, onClick, icon, kind = 'solid', size = 'md' }) {
  const solid = kind === 'solid';
  const h = size === 'sm' ? 36 : 44;
  return (
    <button onClick={onClick} style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7, height: h, padding: size === 'sm' ? '0 14px' : '0 18px', borderRadius: 12, cursor: 'pointer',
      fontFamily: "'Hanken Grotesk', sans-serif", fontSize: size === 'sm' ? 13 : 14.5, fontWeight: 600, letterSpacing: 0.1,
      border: solid ? 'none' : '1px solid var(--a-line-strong)', background: solid ? 'var(--a-ink)' : 'transparent', color: solid ? 'var(--a-cream)' : 'var(--a-ink)', whiteSpace: 'nowrap',
    }}>{icon && <Icon name={icon} size={size === 'sm' ? 16 : 18} />}{children}</button>
  );
}

// drawer / modal panel that slides from right on desktop, bottom on mobile
function Drawer({ open, onClose, title, children, footer }) {
  const [render, setRender] = useState(open);
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (open) { setRender(true); requestAnimationFrame(() => requestAnimationFrame(() => setShow(true))); }
    else { setShow(false); const tm = setTimeout(() => setRender(false), 300); return () => clearTimeout(tm); }
  }, [open]);
  if (!render) return null;
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 300 }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(40,32,24,0.4)', opacity: show ? 1 : 0, transition: 'opacity .3s', backdropFilter: 'blur(2px)' }} />
      <div className="admin-drawer" style={{ transform: show ? 'translate(0,0)' : 'var(--drawer-hidden)', transition: 'transform .32s cubic-bezier(.32,.72,0,1)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 22px 14px', borderBottom: '1px solid var(--a-line)', flexShrink: 0 }}>
          <h3 style={{ margin: 0, fontFamily: "'Schibsted Grotesk','IBM Plex Sans Thai',sans-serif", fontWeight: 600, fontSize: 20, color: 'var(--a-ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{title}</h3>
          <button onClick={onClose} style={{ width: 36, height: 36, borderRadius: 99, border: '1px solid var(--a-line)', background: 'var(--a-surface)', color: 'var(--a-ink-soft)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="x" size={18} /></button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 22px' }}>{children}</div>
        {footer && <div style={{ flexShrink: 0, padding: '14px 22px', borderTop: '1px solid var(--a-line)', background: 'var(--a-surface)', display: 'flex', gap: 10 }}>{footer}</div>}
      </div>
    </div>
  );
}

Object.assign(window, { AdminCtx, useAdmin, NAV, aT, AdminBrand, Sidebar, MobileNav, Topbar, Card, Stat, Badge, Dot, Avatar, CapBar, PageTitle, Btn, Drawer });
