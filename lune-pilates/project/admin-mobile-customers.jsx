// admin-mobile-customers.jsx — Customers list, detail, Add Customer form
function MCustomers() {
  const { t, tt, lang, go, openCustomer } = useM();
  const [q, setQ] = React.useState('');
  const [filter, setFilter] = React.useState('all');
  let list = CUSTOMERS.filter((c) => {
    if (filter === 'pending') return c.status === 'pending';
    if (filter === 'member') return c.member && c.status !== 'pending';
    if (filter === 'guest') return !c.member && c.status !== 'pending';
    return true; // all
  });
  if (q) list = list.filter((c) => tt(c.name).toLowerCase().includes(q.toLowerCase()) || c.phone.includes(q) || (c.house || '').toLowerCase().includes(q.toLowerCase()));
  // pending first within the visible list
  list = [...list].sort((a, b) => (a.status === 'pending' ? -1 : 0) - (b.status === 'pending' ? -1 : 0));
  const memberCount = CUSTOMERS.filter((c) => c.member && c.status !== 'pending').length;
  const guestCount = CUSTOMERS.filter((c) => !c.member && c.status !== 'pending').length;
  const pendingCount = CUSTOMERS.filter((c) => c.status === 'pending').length;

  return (
    <div style={{ padding: '2px 18px 26px' }}>
      {/* search */}
      <div style={{ position: 'relative', marginBottom: 12 }}>
        <span style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)', color: 'var(--a-muted)' }}><Icon name="profile" size={18} /></span>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={lang === 'th' ? 'ค้นหาชื่อ เบอร์ บ้านเลขที่…' : 'Search name, phone, house…'} style={{ width: '100%', height: 46, padding: '0 14px 0 42px', borderRadius: 13, border: '1px solid var(--a-line-strong)', background: 'var(--a-surface-2)', color: 'var(--a-ink)', fontFamily: "'Hanken Grotesk',sans-serif", fontSize: 14 }} />
      </div>
      {/* filter chips */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, overflowX: 'auto', scrollbarWidth: 'none' }}>
        {[['all', t('all'), CUSTOMERS.length], ['pending', t('pending_filter'), pendingCount], ['member', t('members_only'), memberCount], ['guest', t('guests'), guestCount]].map(([k, lb, n]) => {
          const on = filter === k;
          const alert = k === 'pending' && n > 0;
          return (
            <button key={k} onClick={() => setFilter(k)} style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 99, cursor: 'pointer', border: '1px solid ' + (on ? 'transparent' : alert ? 'rgba(154,123,69,0.4)' : 'var(--a-line-strong)'), background: on ? (alert ? '#9A7B45' : 'var(--a-ink)') : (alert ? 'rgba(193,160,121,0.12)' : 'transparent'), color: on ? '#fff' : (alert ? '#9A7B45' : 'var(--a-ink-soft)'), fontFamily: "'Hanken Grotesk','IBM Plex Sans Thai',sans-serif", fontSize: 13, fontWeight: 600 }}>
              {alert && !on && <span style={{ width: 6, height: 6, borderRadius: 99, background: '#9A7B45' }} />}
              {lb}<span style={{ opacity: 0.6, fontSize: 11.5 }}>{n}</span>
            </button>
          );
        })}
      </div>

      {/* list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
        {list.map((c) => {
          const pending = c.status === 'pending';
          return (
          <div key={c.id} onClick={() => openCustomer(c.id)} style={{ display: 'flex', alignItems: 'center', gap: 12, background: pending ? 'rgba(193,160,121,0.09)' : 'var(--a-surface-2)', border: '1px solid ' + (pending ? 'rgba(193,160,121,0.34)' : 'var(--a-line)'), borderRadius: 15, padding: '12px 14px', cursor: 'pointer', boxShadow: 'var(--a-shadow)' }}>
            <Avatar id={c.id} size={42} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontFamily: "'Hanken Grotesk','IBM Plex Sans Thai',sans-serif", fontSize: 14.5, fontWeight: 600, color: 'var(--a-ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{tt(c.name)}</span>
                {c.member && !pending && <Sparkle size={11} color="var(--a-taupe)" />}
              </div>
              <div style={{ fontFamily: "'Hanken Grotesk','IBM Plex Sans Thai',sans-serif", fontSize: 12, color: 'var(--a-muted)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 5 }}>
                {pending ? <><span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: '#06C755', fontWeight: 700 }}><span style={{ width: 13, height: 13, borderRadius: 3, background: '#06C755', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, fontWeight: 800 }}>L</span>LINE</span><span style={{ color: 'var(--a-line-strong)' }}>·</span>{tt(c.regWhen)}</> : <span>{c.phone}{c.house && c.house !== '—' ? ' · ' + t('house') + ' ' + c.house : ''}</span>}
              </div>
            </div>
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              {pending
                ? <Badge tone="amber"><Icon name="clock" size={11} />{t('pending_approval')}</Badge>
                : <><div style={{ fontFamily: "'Schibsted Grotesk',sans-serif", fontWeight: 700, fontSize: 15, color: c.status === 'expiring' ? '#A56A52' : c.credits > 0 ? 'var(--a-ink)' : 'var(--a-muted)' }}>{c.credits}<span style={{ fontFamily: "'Hanken Grotesk',sans-serif", fontSize: 10.5, color: 'var(--a-muted)', marginLeft: 2 }}>{t('hrs')}</span></div>
              <div style={{ fontFamily: "'Hanken Grotesk',sans-serif", fontSize: 10.5, color: c.member ? 'var(--a-sage-deep)' : 'var(--a-muted)', marginTop: 1 }}>{c.member ? t('member') : t('guest')}</div></>}
            </div>
          </div>
          );
        })}
        {list.length === 0 && <div style={{ textAlign: 'center', padding: '40px', fontFamily: "'Hanken Grotesk',sans-serif", color: 'var(--a-muted)', fontSize: 14 }}>—</div>}
      </div>
    </div>
  );
}

// ── customer detail sheet ──
function MCustomerDetail({ id, onClose }) {
  const { t, tt, lang, go } = useM();
  const c = cust(id); if (!c) return null;
  const [approved, setApproved] = React.useState(false);
  const houseMates = c.house && c.house !== '—' ? CUSTOMERS.filter((x) => x.house === c.house && x.status !== 'pending') : [];
  const pending = c.status === 'pending' && !approved;

  // approval success state
  if (c.status === 'pending' && approved) {
    return (
      <div style={{ textAlign: 'center', paddingTop: 8 }}>
        <div style={{ width: 74, height: 74, borderRadius: 99, margin: '4px auto 16px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--a-sage)', color: '#fff', boxShadow: '0 10px 28px rgba(140,154,126,0.4)' }}><Icon name="check" size={34} stroke={2} /></div>
        <h2 style={{ margin: '0 0 8px', fontFamily: "'Schibsted Grotesk','IBM Plex Sans Thai',sans-serif", fontWeight: 600, fontSize: 25, color: 'var(--a-ink)' }}>{t('approved_title')}</h2>
        <p style={{ margin: '0 auto 16px', maxWidth: 280, fontFamily: "'Hanken Grotesk','IBM Plex Sans Thai',sans-serif", fontSize: 14, lineHeight: 1.5, color: 'var(--a-ink-soft)' }}><strong>{tt(c.name)}</strong> {t('approved_sub')}</p>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '9px 15px', borderRadius: 99, background: 'rgba(6,199,85,0.1)', marginBottom: 20 }}>
          <span style={{ width: 18, height: 18, borderRadius: 5, background: '#06C755', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800 }}>L</span>
          <span style={{ fontFamily: "'Hanken Grotesk','IBM Plex Sans Thai',sans-serif", fontSize: 13, fontWeight: 600, color: '#0a8f43' }}>{t('line_sent')}</span>
        </div>
        <MPrimary onClick={onClose}>{t('done2')}</MPrimary>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18 }}>
        <Avatar id={c.id} size={58} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontFamily: "'Schibsted Grotesk','IBM Plex Sans Thai',sans-serif", fontWeight: 600, fontSize: 21, color: 'var(--a-ink)' }}>{tt(c.name)}</span>
            {pending ? <Badge tone="amber"><Icon name="clock" size={10} />{t('pending_approval')}</Badge> : c.member ? <Badge tone="ink"><Sparkle size={10} color="#C9B89E" />{t('member')}</Badge> : <Badge tone="neutral">{t('guest')}</Badge>}
          </div>
          <div style={{ fontFamily: "'Hanken Grotesk',sans-serif", fontSize: 13, color: 'var(--a-muted)', marginTop: 3 }}>{c.phone}</div>
        </div>
      </div>

      {/* ── pending registration approval ── */}
      {pending ? (
        <div>
          <div style={{ background: 'rgba(193,160,121,0.1)', border: '1px solid rgba(193,160,121,0.34)', borderRadius: 15, padding: '16px 16px', marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 10 }}>
              <span style={{ width: 26, height: 26, borderRadius: 7, background: '#06C755', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 800 }}>L</span>
              <span style={{ fontFamily: "'Schibsted Grotesk','IBM Plex Sans Thai',sans-serif", fontWeight: 600, fontSize: 15.5, color: 'var(--a-ink)' }}>{t('approve_title')}</span>
            </div>
            <p style={{ margin: '0 0 14px', fontFamily: "'Hanken Grotesk','IBM Plex Sans Thai',sans-serif", fontSize: 12.5, lineHeight: 1.55, color: 'var(--a-ink-soft)' }}>{t('approve_note')}</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <RegRow label={t('full_name')} value={tt(c.name)} />
              <RegRow label={t('phone')} value={c.phone} />
              <RegRow label={t('house_no')} value={c.house && c.house !== '—' ? c.house : (lang === 'th' ? 'ไม่ได้ระบุ' : 'Not provided')} />
              <RegRow label={t('customer_type')} value={c.member ? t('member') : t('guest')} />
              <RegRow label={t('via_line')} value={tt(c.regWhen)} />
              <RegRow label={t('wants_pkg')} value={tt(pkgName(c.wantPkg))} strong />
            </div>
          </div>
          <MPrimary onClick={() => setApproved(true)} icon="check">{t('confirm_pay')}</MPrimary>
          <p style={{ margin: '12px 4px 0', textAlign: 'center', fontFamily: "'Hanken Grotesk','IBM Plex Sans Thai',sans-serif", fontSize: 11.5, color: 'var(--a-muted)' }}>{lang === 'th' ? 'เมื่อยืนยันแล้ว ระบบจะส่งข้อความต้อนรับทาง LINE อัตโนมัติ' : 'On confirm, a LINE welcome message is sent automatically'}</p>
        </div>
      ) : (
        <>
      {/* stats */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 9, marginBottom: 16 }}>
        <MiniStat2 label={t('credits')} value={c.credits} sub={t('hrs')} tone={c.status === 'expiring' ? 'rose' : null} />
        <MiniStat2 label={t('house')} value={c.house || '—'} sub={houseMates.length ? houseMates.length + (lang === 'th' ? ' คน' : ' ppl') : ''} />
        <MiniStat2 label={lang === 'th' ? 'มาเรียน' : 'Visits'} value={c.visits} sub={t('total_visits')} />
      </div>

      {/* actions */}
      <div style={{ display: 'flex', gap: 9, marginBottom: 18 }}>
        <button onClick={() => { onClose(); go('pos'); }} style={detailActBtn(true)}><Icon name="qr" size={18} />{t('sell_pkg')}</button>
        <button style={detailActBtn(false)}><Icon name="bookings" size={18} />{t('book_class')}</button>
        <button style={{ ...detailActBtn(false), flex: 'none', width: 54 }}><Icon name="bell" size={18} /></button>
      </div>

      {/* sharing / expiry */}
      {c.member && houseMates.length > 0 && (
        <div>
          <Eyebrow2 style={{ marginBottom: 10 }}>{t('shared_grp')} · {t('house')} {c.house}</Eyebrow2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {houseMates.map((hm) => (
              <div key={hm.id} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '10px 12px', borderRadius: 13, border: '1px solid var(--a-line)' }}>
                <Avatar id={hm.id} size={32} />
                <span style={{ flex: 1, fontFamily: "'Hanken Grotesk','IBM Plex Sans Thai',sans-serif", fontSize: 13.5, fontWeight: 600, color: 'var(--a-ink)' }}>{tt(hm.name)}</span>
                {hm.id === c.id && <Badge tone="neutral">{lang === 'th' ? 'คนนี้' : 'This one'}</Badge>}
              </div>
            ))}
          </div>
        </div>
      )}
      {!c.member && (
        <div style={{ display: 'flex', gap: 9, padding: '12px 14px', borderRadius: 13, background: 'var(--a-cream-2)' }}>
          <Icon name="info" size={18} style={{ color: 'var(--a-muted)', flexShrink: 0, marginTop: 1 }} />
          <p style={{ margin: 0, fontFamily: "'Hanken Grotesk',sans-serif", fontSize: 12.5, lineHeight: 1.5, color: 'var(--a-ink-soft)' }}>{lang === 'th' ? 'ลูกค้าทั่วไป — เครดิตแบ่งปันไม่ได้ อัปเกรดเป็นสมาชิกเพื่อรับสิทธิ' : 'Guest — credits cannot be shared. Upgrade to member to unlock sharing.'}</p>
        </div>
      )}
        </>
      )}
    </div>
  );
}

function RegRow({ label, value, strong }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '9px 12px', borderRadius: 11, background: 'var(--a-surface-2)', border: '1px solid var(--a-line)' }}>
      <span style={{ fontFamily: "'Hanken Grotesk','IBM Plex Sans Thai',sans-serif", fontSize: 12.5, color: 'var(--a-muted)' }}>{label}</span>
      <span style={{ fontFamily: "'Hanken Grotesk','IBM Plex Sans Thai',sans-serif", fontSize: 13.5, fontWeight: strong ? 700 : 600, color: 'var(--a-ink)' }}>{value}</span>
    </div>
  );
}

function MiniStat2({ label, value, sub, tone }) {
  return (
    <div style={{ padding: '12px 12px', borderRadius: 13, border: '1px solid var(--a-line)', background: 'var(--a-surface)' }}>
      <div style={{ fontFamily: "'Hanken Grotesk',sans-serif", fontSize: 10, fontWeight: 600, letterSpacing: 0.4, textTransform: 'uppercase', color: 'var(--a-muted)' }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 3, marginTop: 4 }}>
        <span style={{ fontFamily: "'Schibsted Grotesk',sans-serif", fontWeight: 700, fontSize: 18, color: tone === 'rose' ? '#A56A52' : 'var(--a-ink)' }}>{value}</span>
        {sub && <span style={{ fontFamily: "'Hanken Grotesk',sans-serif", fontSize: 10.5, color: 'var(--a-muted)' }}>{sub}</span>}
      </div>
    </div>
  );
}
function detailActBtn(solid) {
  return { flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7, height: 48, borderRadius: 13, cursor: 'pointer', border: solid ? 'none' : '1px solid var(--a-line-strong)', background: solid ? 'var(--a-ink)' : 'transparent', color: solid ? '#fff' : 'var(--a-ink)', fontFamily: "'Hanken Grotesk',sans-serif", fontSize: 13.5, fontWeight: 600 };
}

// ═══════════════ ADD CUSTOMER ═══════════════
function MAddCustomer({ onBack }) {
  const { t, tt, lang, go } = useM();
  const [name, setName] = React.useState('');
  const [phone, setPhone] = React.useState('');
  const [type, setType] = React.useState('guest');
  const [house, setHouse] = React.useState('');
  const [done, setDone] = React.useState(false);
  const valid = name.trim() && phone.trim().length >= 9 && (type === 'guest' || house.trim());

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--a-cream)' }}>
      <MHeader title={t('new_customer')} onBack={onBack} />
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 18px 30px' }}>
        <FieldM label={t('full_name')}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={lang === 'th' ? 'เช่น พิม ศรีใส' : 'e.g. Pim Srisai'} style={inputM} />
        </FieldM>
        <FieldM label={t('phone')}>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="08X XXX XXXX" style={inputM} />
        </FieldM>
        <FieldM label={t('customer_type')}>
          <div style={{ display: 'flex', gap: 10 }}>
            {[['guest', t('guest'), lang === 'th' ? 'ซื้อเป็นครั้ง โอนเครดิตไม่ได้' : 'Pay per package, no sharing'], ['member', t('member'), lang === 'th' ? 'แบ่งปันเครดิตในบ้านได้' : 'Can share credits in household']].map(([k, lb, hint]) => {
              const on = type === k;
              return (
                <button key={k} onClick={() => setType(k)} style={{ flex: 1, textAlign: 'left', padding: '14px 14px', borderRadius: 14, cursor: 'pointer', border: '1.5px solid ' + (on ? 'var(--a-taupe)' : 'var(--a-line)'), background: on ? 'var(--a-surface-2)' : 'transparent' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <span style={{ width: 18, height: 18, borderRadius: 99, flexShrink: 0, border: '1.5px solid ' + (on ? 'var(--a-taupe)' : 'var(--a-line-strong)'), background: on ? 'var(--a-taupe)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{on && <Icon name="check" size={11} stroke={3} style={{ color: '#fff' }} />}</span>
                    <span style={{ fontFamily: "'Hanken Grotesk',sans-serif", fontSize: 14.5, fontWeight: 600, color: 'var(--a-ink)' }}>{lb}</span>
                    {k === 'member' && <Sparkle size={11} color="var(--a-taupe)" />}
                  </div>
                  <div style={{ fontFamily: "'Hanken Grotesk',sans-serif", fontSize: 11.5, color: 'var(--a-muted)', marginTop: 6, lineHeight: 1.4 }}>{hint}</div>
                </button>
              );
            })}
          </div>
        </FieldM>
        <FieldM label={t('house_no')} hint={type === 'member' ? t('house_hint') : t('optional')}>
          <input value={house} onChange={(e) => setHouse(e.target.value)} placeholder={lang === 'th' ? 'เช่น A-114' : 'e.g. A-114'} style={inputM} />
        </FieldM>
      </div>
      <div style={{ flexShrink: 0, padding: '14px 18px 30px', background: 'var(--a-surface-2)', borderTop: '1px solid var(--a-line)' }}>
        <MPrimary onClick={() => valid && setDone(true)} disabled={!valid} icon="check">{t('save_customer')}</MPrimary>
      </div>

      <MSheet open={done} onClose={onBack} maxH="62%">
        <div style={{ textAlign: 'center', paddingTop: 8 }}>
          <div style={{ width: 72, height: 72, borderRadius: 99, margin: '4px auto 16px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--a-sage)', color: '#fff', boxShadow: '0 10px 28px rgba(140,154,126,0.4)' }}><Icon name="check" size={34} stroke={2} /></div>
          <h2 style={{ margin: '0 0 8px', fontFamily: "'Schibsted Grotesk','IBM Plex Sans Thai',sans-serif", fontWeight: 600, fontSize: 26, color: 'var(--a-ink)' }}>{t('added_customer')}</h2>
          <p style={{ margin: '0 auto 20px', maxWidth: 280, fontFamily: "'Hanken Grotesk','IBM Plex Sans Thai',sans-serif", fontSize: 14, lineHeight: 1.5, color: 'var(--a-ink-soft)' }}><strong>{name || (lang === 'th' ? 'ลูกค้า' : 'Customer')}</strong> {t('added_sub')}</p>
          <MPrimary onClick={onBack}>{t('done2')}</MPrimary>
        </div>
      </MSheet>
    </div>
  );
}

function FieldM({ label, hint, children }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, marginBottom: 8 }}>
        <label style={{ fontFamily: "'Hanken Grotesk','IBM Plex Sans Thai',sans-serif", fontSize: 12.5, fontWeight: 600, color: 'var(--a-ink-soft)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{label}</label>
        {hint && <span style={{ fontFamily: "'Hanken Grotesk','IBM Plex Sans Thai',sans-serif", fontSize: 11, color: 'var(--a-muted)', flexShrink: 0, whiteSpace: 'nowrap' }}>{hint}</span>}
      </div>
      {children}
    </div>
  );
}
const inputM = { width: '100%', height: 50, padding: '0 16px', borderRadius: 13, border: '1px solid var(--a-line-strong)', background: 'var(--a-surface-2)', color: 'var(--a-ink)', fontFamily: "'Hanken Grotesk','IBM Plex Sans Thai',sans-serif", fontSize: 15 };

Object.assign(window, { MCustomers, MCustomerDetail, MiniStat2, MAddCustomer, FieldM, inputM, RegRow });
