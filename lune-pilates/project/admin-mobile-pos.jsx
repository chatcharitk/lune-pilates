// admin-mobile-pos.jsx — POS / checkout
function MPos() {
  const { t, tt, lang, go } = useM();
  const [tab, setTab] = React.useState('pkg');
  const [cart, setCart] = React.useState([]); // [{id, name, price, qty, kind, hours}]
  const [assignee, setAssignee] = React.useState(null); // customer id or null=walk-in
  const [pickCust, setPickCust] = React.useState(false);
  const [pay, setPay] = React.useState(false);

  const items = tab === 'pkg' ? POS_PACKAGES : POS_RETAIL;
  const total = cart.reduce((a, x) => a + x.price * x.qty, 0);
  const count = cart.reduce((a, x) => a + x.qty, 0);

  function add(it) {
    setCart((c) => { const f = c.find((x) => x.id === it.id); return f ? c.map((x) => x.id === it.id ? { ...x, qty: x.qty + 1 } : x) : [...c, { ...it, qty: 1 }]; });
  }
  function setQty(id, d) {
    setCart((c) => c.map((x) => x.id === id ? { ...x, qty: Math.max(0, x.qty + d) } : x).filter((x) => x.qty > 0));
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--a-cream)' }}>
      <MHeader title={t('new_sale')} sub={t('pos')} right={<MLangToggle />} />

      {/* catalog tabs */}
      <div style={{ display: 'flex', gap: 8, padding: '4px 18px 12px', flexShrink: 0 }}>
        {[['pkg', t('packages_t')], ['retail', t('retail')]].map(([k, lb]) => (
          <button key={k} onClick={() => setTab(k)} style={{ flex: 1, padding: '11px', borderRadius: 12, border: 'none', cursor: 'pointer', fontFamily: "'Hanken Grotesk',sans-serif", fontSize: 14, fontWeight: 600, background: tab === k ? 'var(--a-ink)' : 'var(--a-surface-2)', color: tab === k ? 'var(--a-cream)' : 'var(--a-ink-soft)', border: tab === k ? 'none' : '1px solid var(--a-line)' }}>{lb}</button>
        ))}
      </div>

      {/* item grid */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 18px 20px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {items.map((it) => {
            const inCart = cart.find((x) => x.id === it.id);
            return (
              <button key={it.id} onClick={() => add(it)} style={{ position: 'relative', textAlign: 'left', padding: '15px 15px', borderRadius: 16, cursor: 'pointer', border: '1px solid ' + (inCart ? 'var(--a-taupe)' : 'var(--a-line)'), background: 'var(--a-surface-2)', boxShadow: 'var(--a-shadow)', minHeight: 104, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                {inCart && <span style={{ position: 'absolute', top: 10, right: 10, width: 22, height: 22, borderRadius: 99, background: 'var(--a-taupe)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Schibsted Grotesk',sans-serif", fontWeight: 700, fontSize: 12 }}>{inCart.qty}</span>}
                <div style={{ width: 34, height: 34, borderRadius: 10, background: 'var(--a-cream-2)', color: 'var(--a-taupe-deep)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name={it.kind === 'pkg' ? 'clock' : 'bookings'} size={18} /></div>
                <div>
                  <div style={{ fontFamily: "'Hanken Grotesk','IBM Plex Sans Thai',sans-serif", fontSize: 13.5, fontWeight: 600, color: 'var(--a-ink)', lineHeight: 1.2 }}>{tt(it.name)}</div>
                  <div style={{ fontFamily: "'Schibsted Grotesk',sans-serif", fontWeight: 700, fontSize: 16, color: 'var(--a-taupe-deep)', marginTop: 4 }}>{bahtA(it.price)}</div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* cart bar */}
      {count > 0 && (
        <div style={{ flexShrink: 0, background: 'var(--a-surface-2)', borderTop: '1px solid var(--a-line)', boxShadow: '0 -10px 30px rgba(72,58,40,0.07)', padding: '12px 18px 28px' }}>
          {/* assignee row */}
          <button onClick={() => setPickCust(true)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 12, border: '1px dashed var(--a-line-strong)', background: 'var(--a-surface)', cursor: 'pointer', marginBottom: 12 }}>
            {assignee ? <Avatar id={assignee} size={28} /> : <span style={{ width: 28, height: 28, borderRadius: 99, background: 'var(--a-cream-2)', color: 'var(--a-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="person" size={16} /></span>}
            <span style={{ flex: 1, textAlign: 'left', fontFamily: "'Hanken Grotesk','IBM Plex Sans Thai',sans-serif", fontSize: 13.5, fontWeight: 600, color: assignee ? 'var(--a-ink)' : 'var(--a-muted)' }}>{assignee ? tt(cust(assignee).name) : t('walk_in')}</span>
            <span style={{ fontFamily: "'Hanken Grotesk',sans-serif", fontSize: 12.5, fontWeight: 600, color: 'var(--a-taupe-deep)' }}>{t('assign_to')}</span>
          </button>
          {/* cart items condensed */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginBottom: 12, maxHeight: 132, overflowY: 'auto' }}>
            {cart.map((x) => (
              <div key={x.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ flex: 1, fontFamily: "'Hanken Grotesk','IBM Plex Sans Thai',sans-serif", fontSize: 13.5, color: 'var(--a-ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{tt(x.name)}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 0, border: '1px solid var(--a-line-strong)', borderRadius: 9, overflow: 'hidden' }}>
                  <button onClick={() => setQty(x.id, -1)} style={qtyBtn}><span style={{ width: 11, height: 2, borderRadius: 2, background: 'currentColor', display: 'block' }} /></button>
                  <span style={{ width: 28, textAlign: 'center', fontFamily: "'Schibsted Grotesk',sans-serif", fontWeight: 700, fontSize: 14, color: 'var(--a-ink)' }}>{x.qty}</span>
                  <button onClick={() => setQty(x.id, 1)} style={qtyBtn}><Icon name="plus" size={12} /></button>
                </div>
                <span style={{ width: 64, textAlign: 'right', fontFamily: "'Schibsted Grotesk',sans-serif", fontWeight: 600, fontSize: 13.5, color: 'var(--a-ink)' }}>{bahtA(x.price * x.qty)}</span>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ flexShrink: 0 }}>
              <div style={{ fontFamily: "'Hanken Grotesk',sans-serif", fontSize: 11, color: 'var(--a-muted)' }}>{t('subtotal')} · {count} {lang === 'th' ? 'ชิ้น' : 'items'}</div>
              <div style={{ fontFamily: "'Schibsted Grotesk',sans-serif", fontWeight: 700, fontSize: 23, color: 'var(--a-ink)', lineHeight: 1.1 }}>{bahtA(total)}</div>
            </div>
            <div style={{ flex: 1 }}><MPrimary onClick={() => setPay(true)} icon="arrowR">{t('charge')}</MPrimary></div>
          </div>
        </div>
      )}

      {/* pick customer sheet */}
      <MSheet open={pickCust} onClose={() => setPickCust(false)} maxH="80%">
        <h2 style={sheetTitleM}>{t('select_customer')}</h2>
        <button onClick={() => { setAssignee(null); setPickCust(false); }} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 11, padding: '12px 14px', borderRadius: 13, border: '1px solid var(--a-line)', background: 'var(--a-surface-2)', cursor: 'pointer', marginBottom: 8 }}>
          <span style={{ width: 36, height: 36, borderRadius: 99, background: 'var(--a-cream-2)', color: 'var(--a-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="person" size={18} /></span>
          <span style={{ fontFamily: "'Hanken Grotesk','IBM Plex Sans Thai',sans-serif", fontSize: 14.5, fontWeight: 600, color: 'var(--a-ink)' }}>{t('walk_in')}</span>
        </button>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          {CUSTOMERS.map((c) => (
            <button key={c.id} onClick={() => { setAssignee(c.id); setPickCust(false); }} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 11, padding: '10px 14px', borderRadius: 13, border: '1px solid var(--a-line)', background: 'var(--a-surface-2)', cursor: 'pointer' }}>
              <Avatar id={c.id} size={34} />
              <div style={{ flex: 1, textAlign: 'left', minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ fontFamily: "'Hanken Grotesk','IBM Plex Sans Thai',sans-serif", fontSize: 14, fontWeight: 600, color: 'var(--a-ink)' }}>{tt(c.name)}</span>{c.member && <Sparkle size={10} color="var(--a-taupe)" />}</div>
                <div style={{ fontFamily: "'Hanken Grotesk',sans-serif", fontSize: 11.5, color: 'var(--a-muted)' }}>{c.phone}</div>
              </div>
            </button>
          ))}
        </div>
      </MSheet>

      {/* payment sheet */}
      <MSheet open={pay} onClose={() => setPay(false)} maxH="86%">
        <MPayFlow total={total} cart={cart} assignee={assignee} onDone={() => { setPay(false); setCart([]); setAssignee(null); }} />
      </MSheet>
    </div>
  );
}
const qtyBtn = { width: 30, height: 30, border: 'none', background: 'var(--a-surface)', color: 'var(--a-ink)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' };
const sheetTitleM = { margin: '4px 0 14px', fontFamily: "'Schibsted Grotesk','IBM Plex Sans Thai',sans-serif", fontWeight: 600, fontSize: 22, color: 'var(--a-ink)' };

function MPayFlow({ total, cart, assignee, onDone }) {
  const { t, tt, lang } = useM();
  const [method, setMethod] = React.useState('promptpay');
  const [done, setDone] = React.useState(false);
  const pkgHours = cart.filter((x) => x.kind === 'pkg').reduce((a, x) => a + (x.hours || 0) * x.qty, 0);

  if (done) {
    return (
      <div style={{ textAlign: 'center', paddingTop: 8 }}>
        <div style={{ width: 72, height: 72, borderRadius: 99, margin: '4px auto 16px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--a-sage)', color: '#fff', boxShadow: '0 10px 28px rgba(140,154,126,0.4)' }}><Icon name="check" size={34} stroke={2} /></div>
        <h2 style={{ margin: '0 0 6px', fontFamily: "'Schibsted Grotesk','IBM Plex Sans Thai',sans-serif", fontWeight: 600, fontSize: 26, color: 'var(--a-ink)' }}>{t('sale_done')}</h2>
        <div style={{ fontFamily: "'Schibsted Grotesk',sans-serif", fontWeight: 700, fontSize: 30, color: 'var(--a-taupe-deep)', margin: '6px 0 4px' }}>{bahtA(total)}</div>
        {pkgHours > 0 && assignee && <p style={{ margin: '0 auto 18px', fontFamily: "'Hanken Grotesk','IBM Plex Sans Thai',sans-serif", fontSize: 13.5, color: 'var(--a-ink-soft)' }}>+{pkgHours} {t('hrs')} → {tt(cust(assignee).name)}</p>}
        <button style={{ width: '100%', height: 48, marginBottom: 10, borderRadius: 13, border: '1px solid var(--a-line-strong)', background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontFamily: "'Hanken Grotesk','IBM Plex Sans Thai',sans-serif", fontSize: 14, fontWeight: 600, color: '#06C755' }}><span style={{ width: 22, height: 22, borderRadius: 6, background: '#06C755', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800 }}>L</span>{t('receipt')}</button>
        <MPrimary onClick={onDone} tone="sage">{t('new_sale_btn')}</MPrimary>
      </div>
    );
  }

  return (
    <div>
      <h2 style={sheetTitleM}>{t('payment_method')}</h2>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderRadius: 14, background: 'var(--a-cream-2)', marginBottom: 16 }}>
        <span style={{ fontFamily: "'Hanken Grotesk',sans-serif", fontSize: 14, color: 'var(--a-ink-soft)' }}>{t('total')}</span>
        <span style={{ fontFamily: "'Schibsted Grotesk',sans-serif", fontWeight: 700, fontSize: 24, color: 'var(--a-ink)' }}>{bahtA(total)}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginBottom: 18 }}>
        {[['promptpay', t('pay_promptpay'), 'qr'], ['cash', t('pay_cash'), 'bookings'], ['card', t('pay_card'), 'qr']].map(([k, lb, ic]) => {
          const on = method === k;
          return (
            <button key={k} onClick={() => setMethod(k)} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', borderRadius: 14, cursor: 'pointer', border: '1.5px solid ' + (on ? 'var(--a-taupe)' : 'var(--a-line)'), background: on ? 'var(--a-surface-2)' : 'transparent' }}>
              <span style={{ width: 38, height: 38, borderRadius: 11, background: 'var(--a-cream-2)', color: 'var(--a-taupe-deep)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name={ic} size={19} /></span>
              <span style={{ flex: 1, textAlign: 'left', fontFamily: "'Hanken Grotesk','IBM Plex Sans Thai',sans-serif", fontSize: 15, fontWeight: 600, color: 'var(--a-ink)' }}>{lb}</span>
              <span style={{ width: 22, height: 22, borderRadius: 99, border: '1.5px solid ' + (on ? 'var(--a-taupe)' : 'var(--a-line-strong)'), background: on ? 'var(--a-taupe)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{on && <Icon name="check" size={12} stroke={3} style={{ color: '#fff' }} />}</span>
            </button>
          );
        })}
      </div>
      {method === 'promptpay' && (
        <div style={{ textAlign: 'center', marginBottom: 18 }}>
          <div style={{ display: 'inline-block', padding: 16, borderRadius: 16, background: 'var(--a-surface-2)', border: '1px solid var(--a-line)', boxShadow: 'var(--a-shadow)' }}><QRMini size={150} /></div>
          <div style={{ fontFamily: "'Hanken Grotesk','IBM Plex Sans Thai',sans-serif", fontSize: 12.5, color: 'var(--a-muted)', marginTop: 10 }}>{lang === 'th' ? 'ให้ลูกค้าสแกนเพื่อชำระเงิน' : 'Show to customer to scan'}</div>
        </div>
      )}
      <MPrimary onClick={() => setDone(true)} icon="check">{t('complete_sale')}</MPrimary>
    </div>
  );
}

function QRMini({ size = 150 }) {
  const n = 21; const cells = [];
  const isFinder = (r, c) => (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7);
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) { if (isFinder(r, c)) continue; if ((r * 31 + c * 17 + r * c * 7) % 11 < 5) cells.push([r, c]); }
  const px = size / n;
  const finder = (x, y) => (<g key={`${x}-${y}`}><rect x={x * px} y={y * px} width={px * 7} height={px * 7} rx={px} fill="var(--a-ink)" /><rect x={(x + 1) * px} y={(y + 1) * px} width={px * 5} height={px * 5} rx={px * .6} fill="var(--a-surface-2)" /><rect x={(x + 2) * px} y={(y + 2) * px} width={px * 3} height={px * 3} rx={px * .4} fill="var(--a-ink)" /></g>);
  return (<svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>{cells.map(([r, c]) => <rect key={`${r}-${c}`} x={c * px + px * .08} y={r * px + px * .08} width={px * .84} height={px * .84} rx={px * .3} fill="var(--a-ink)" />)}{finder(0, 0)}{finder(n - 7, 0)}{finder(0, n - 7)}</svg>);
}

Object.assign(window, { MPos, MPayFlow, QRMini, qtyBtn, sheetTitleM });
