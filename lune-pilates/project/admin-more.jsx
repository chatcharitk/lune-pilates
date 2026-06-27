// admin-more.jsx — Bookings & waitlist, Members, Payments, Instructors
// ───────────────────────── Bookings & waitlist ─────────────────────────
function BookingsAdminScreen() {
  const { lang } = useAdmin();
  const [tab, setTab] = useState('bookings');
  return (
    <div>
      <PageTitle>{aT(A.bookings, lang)}</PageTitle>
      <Segmented value={tab} onChange={setTab} options={[['bookings', aT(A.all_bookings, lang)], ['waitlist', aT(A.waitlist, lang)]]} />
      {tab === 'bookings' ? (
        <div className="admin-table" style={{ marginTop: 18 }}>
          <div className="admin-thead admin-bk-grid">
            <span>{aT(A.member, lang)}</span><span>{aT(A.schedule, lang)}</span><span>{aT(A.status, lang)}</span><span></span>
          </div>
          {BOOKINGS.map((b) => {
            const m = mem(b.member); const ty = ATYPES[b.type];
            const tone = b.status === 'checked' ? 'green' : b.status === 'confirmed' ? 'green' : 'neutral';
            return (
              <div key={b.id} className="admin-trow admin-bk-grid">
                <span style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                  <Avatar id={b.member} size={34} />
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: 'block', fontFamily: "'Hanken Grotesk', sans-serif", fontSize: 14, fontWeight: 600, color: 'var(--a-ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{aT(m.name, lang)}</span>
                    <span className="admin-hide-sm" style={{ fontFamily: "'Hanken Grotesk', sans-serif", fontSize: 12, color: 'var(--a-muted)' }}>{m.phone}</span>
                  </span>
                </span>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}><Dot type={b.type} size={7} /><span style={{ fontFamily: "'Hanken Grotesk', sans-serif", fontSize: 13.5, fontWeight: 600, color: 'var(--a-ink)' }}>{aT(ty.short, lang)}</span></span>
                  <span style={{ fontFamily: "'Hanken Grotesk', sans-serif", fontSize: 12, color: 'var(--a-muted)' }}>{b.day} · {b.time}</span>
                </span>
                <span><Badge tone={tone}>{aT(A[b.status] || A.booked, lang)}</Badge></span>
                <span style={{ textAlign: 'right' }}><button style={iconGhost}><Icon name="chevR" size={18} /></button></span>
              </div>
            );
          })}
        </div>
      ) : (
        <div style={{ marginTop: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* group waitlist by class */}
          {TODAY.filter((c) => c.wait.length).map((c) => {
            const ty = ATYPES[c.type];
            return (
              <Card key={c.id}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
                  <Dot type={c.type} size={8} />
                  <span style={{ fontFamily: "'Schibsted Grotesk','IBM Plex Sans Thai',sans-serif", fontWeight: 600, fontSize: 16, color: 'var(--a-ink)' }}>{aT(ty.label, lang)}</span>
                  <span style={{ fontFamily: "'Hanken Grotesk', sans-serif", fontSize: 13, color: 'var(--a-muted)' }}>{lang === 'th' ? 'วันนี้' : 'Today'} · {c.time}</span>
                  <Badge tone="rose">{aT(A.full, lang)}</Badge>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {WAITLIST.filter((w) => w.cls === c.id).map((w, i) => {
                    const m = mem(w.member);
                    return (
                      <div key={w.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: 13, background: w.state === 'notified' ? 'rgba(193,160,121,0.1)' : 'var(--a-surface)', border: '1px solid ' + (w.state === 'notified' ? 'rgba(193,160,121,0.32)' : 'var(--a-line)') }}>
                        <span style={{ fontFamily: "'Schibsted Grotesk', sans-serif", fontWeight: 700, fontSize: 14, color: 'var(--a-muted)', width: 16 }}>{i + 1}</span>
                        <Avatar id={w.member} size={36} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontFamily: "'Hanken Grotesk', sans-serif", fontSize: 14, fontWeight: 600, color: 'var(--a-ink)' }}>{aT(m.name, lang)}</div>
                          <div style={{ fontFamily: "'Hanken Grotesk', sans-serif", fontSize: 12, color: 'var(--a-muted)' }}>{m.member ? aT(A.member, lang) : aT(A.guest, lang)} · {m.phone}</div>
                        </div>
                        {w.state === 'notified'
                          ? <Badge tone="amber"><Icon name="clock" size={13} />{w.mins}m {aT(A.confirm_window, lang)}</Badge>
                          : <Btn kind="ghost" size="sm" icon="bell">{aT(A.notify, lang)}</Btn>}
                      </div>
                    );
                  })}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ───────────────────────── Members ─────────────────────────
function MembersScreen() {
  const { lang } = useAdmin();
  const [q, setQ] = useState('');
  const [openM, setOpenM] = useState(null);
  const list = MEMBERS.filter((m) => !q || aT(m.name, lang).toLowerCase().includes(q.toLowerCase()) || m.house.toLowerCase().includes(q.toLowerCase()) || m.phone.includes(q));
  const m = openM ? mem(openM) : null;
  const houseMates = m ? MEMBERS.filter((x) => x.house === m.house) : [];

  return (
    <div>
      <PageTitle sub={MEMBERS.length + (lang === 'th' ? ' สมาชิกทั้งหมด' : ' total members')}>{aT(A.members, lang)}</PageTitle>
      {/* search */}
      <div style={{ position: 'relative', marginBottom: 18, maxWidth: 420 }}>
        <span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--a-muted)' }}><Icon name="profile" size={18} /></span>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={aT(A.search_members, lang)} style={{ width: '100%', height: 46, padding: '0 14px 0 42px', borderRadius: 12, border: '1px solid var(--a-line-strong)', background: 'var(--a-surface-2)', color: 'var(--a-ink)', fontFamily: "'Hanken Grotesk', sans-serif", fontSize: 14 }} />
      </div>

      <div className="admin-table">
        <div className="admin-thead admin-mem-grid">
          <span>{aT(A.member, lang)}</span><span className="admin-hide-sm">{aT(A.house, lang)}</span><span>{aT(A.credits, lang)}</span><span className="admin-hide-sm">{aT(A.sharing, lang)}</span><span></span>
        </div>
        {list.map((m) => (
          <div key={m.id} className="admin-trow admin-mem-grid" onClick={() => setOpenM(m.id)} style={{ cursor: 'pointer' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
              <Avatar id={m.id} size={36} />
              <span style={{ minWidth: 0 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontFamily: "'Hanken Grotesk', sans-serif", fontSize: 14, fontWeight: 600, color: 'var(--a-ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{aT(m.name, lang)}</span>
                  {m.member && <Sparkle size={11} color="var(--a-taupe)" />}
                </span>
                <span style={{ fontFamily: "'Hanken Grotesk', sans-serif", fontSize: 12, color: 'var(--a-muted)' }}>{m.member ? aT(A.member, lang) : aT(A.guest, lang)}</span>
              </span>
            </span>
            <span className="admin-hide-sm" style={{ fontFamily: "'Hanken Grotesk', sans-serif", fontSize: 13.5, color: 'var(--a-ink-soft)' }}>{m.house}</span>
            <span>
              <span style={{ fontFamily: "'Schibsted Grotesk', sans-serif", fontWeight: 700, fontSize: 15, color: m.status === 'expiring' ? '#A56A52' : 'var(--a-ink)' }}>{m.credits}</span>
              <span style={{ fontFamily: "'Hanken Grotesk', sans-serif", fontSize: 11.5, color: 'var(--a-muted)', marginLeft: 4 }}>{aT(A.hrs, lang)}</span>
              <span style={{ display: 'block', fontFamily: "'Hanken Grotesk', sans-serif", fontSize: 11, color: m.status === 'expiring' ? '#A56A52' : 'var(--a-muted)' }}>{m.status === 'expiring' ? aT(A.expiring, lang) : (lang === 'th' ? 'ถึง ' : 'till ') + m.expiry}</span>
            </span>
            <span className="admin-hide-sm">{m.member ? <Badge tone="green"><Icon name="share" size={12} />{m.share.length > 1 ? m.share.length : aT(A.active, lang)}</Badge> : <span style={{ fontFamily: "'Hanken Grotesk', sans-serif", fontSize: 12.5, color: 'var(--a-muted)' }}>—</span>}</span>
            <span style={{ textAlign: 'right' }}><Icon name="chevR" size={18} style={{ color: 'var(--a-muted)' }} /></span>
          </div>
        ))}
      </div>

      {/* member detail drawer */}
      <Drawer open={!!openM} onClose={() => setOpenM(null)} title={m ? aT(m.name, lang) : ''}>
        {m && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 20 }}>
              <Avatar id={m.id} size={56} />
              <div style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontFamily: "'Schibsted Grotesk','IBM Plex Sans Thai',sans-serif", fontWeight: 600, fontSize: 20, color: 'var(--a-ink)', whiteSpace: 'nowrap' }}>{aT(m.name, lang)}</span>
                  {m.member && <Badge tone="ink"><Sparkle size={10} color="#C9B89E" />{aT(A.member, lang)}</Badge>}
                </div>
                <div style={{ fontFamily: "'Hanken Grotesk', sans-serif", fontSize: 13, color: 'var(--a-muted)', marginTop: 4 }}>{m.phone}</div>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 18 }}>
              <MiniStat label={aT(A.credits, lang)} value={m.credits + ' ' + aT(A.hrs, lang)} sub={(lang === 'th' ? 'ถึง ' : 'expires ') + m.expiry} tone={m.status === 'expiring' ? 'rose' : null} />
              <MiniStat label={aT(A.house, lang)} value={m.house} sub={houseMates.length + (lang === 'th' ? ' คนในบ้าน' : ' in house')} />
            </div>
            {/* sharing group */}
            <div style={{ fontFamily: "'Hanken Grotesk', sans-serif", fontSize: 11.5, fontWeight: 600, letterSpacing: 0.6, textTransform: 'uppercase', color: 'var(--a-muted)', marginBottom: 10 }}>{aT(A.shared_grp, lang)} · {aT(A.house, lang)} {m.house}</div>
            {m.member ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {houseMates.map((hm) => (
                  <div key={hm.id} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '10px 12px', borderRadius: 13, border: '1px solid var(--a-line)' }}>
                    <Avatar id={hm.id} size={34} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontFamily: "'Hanken Grotesk', sans-serif", fontSize: 13.5, fontWeight: 600, color: 'var(--a-ink)' }}>{aT(hm.name, lang)}</div>
                      <div style={{ fontFamily: "'Hanken Grotesk', sans-serif", fontSize: 12, color: 'var(--a-muted)' }}>{hm.member ? aT(A.member, lang) : aT(A.guest, lang)}</div>
                    </div>
                    {hm.id === m.id && <Badge tone="neutral">{lang === 'th' ? 'คนนี้' : 'This member'}</Badge>}
                  </div>
                ))}
                <div style={{ display: 'flex', gap: 9, marginTop: 6, padding: '12px 14px', borderRadius: 13, background: 'rgba(140,154,126,0.1)' }}>
                  <Icon name="share" size={18} style={{ color: 'var(--a-sage-deep)', flexShrink: 0, marginTop: 1 }} />
                  <p style={{ margin: 0, fontFamily: "'Hanken Grotesk', sans-serif", fontSize: 12.5, lineHeight: 1.5, color: 'var(--a-ink-soft)' }}>{lang === 'th' ? 'สมาชิกแบ่งปันเครดิตได้ไม่จำกัดกับคนในบ้านเลขที่เดียวกัน' : 'Credits are shared without limit across this house number.'}</p>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 9, padding: '12px 14px', borderRadius: 13, background: 'var(--a-cream-2)' }}>
                <Icon name="info" size={18} style={{ color: 'var(--a-muted)', flexShrink: 0, marginTop: 1 }} />
                <p style={{ margin: 0, fontFamily: "'Hanken Grotesk', sans-serif", fontSize: 12.5, lineHeight: 1.5, color: 'var(--a-ink-soft)' }}>{lang === 'th' ? 'ลูกค้าทั่วไป — เครดิตโอน/แบ่งปันไม่ได้' : 'Guest account — credits are non-transferable and cannot be shared.'}</p>
              </div>
            )}
          </div>
        )}
      </Drawer>
    </div>
  );
}

function MiniStat({ label, value, sub, tone }) {
  return (
    <div style={{ padding: '14px 15px', borderRadius: 14, border: '1px solid var(--a-line)', background: 'var(--a-surface)' }}>
      <div style={{ fontFamily: "'Hanken Grotesk', sans-serif", fontSize: 11, fontWeight: 600, letterSpacing: 0.5, textTransform: 'uppercase', color: 'var(--a-muted)' }}>{label}</div>
      <div style={{ fontFamily: "'Schibsted Grotesk', sans-serif", fontWeight: 700, fontSize: 20, color: tone === 'rose' ? '#A56A52' : 'var(--a-ink)', marginTop: 4 }}>{value}</div>
      {sub && <div style={{ fontFamily: "'Hanken Grotesk', sans-serif", fontSize: 11.5, color: tone === 'rose' ? '#A56A52' : 'var(--a-muted)', marginTop: 1 }}>{sub}</div>}
    </div>
  );
}

// ───────────────────────── Payments ─────────────────────────
function PaymentsScreen() {
  const { lang } = useAdmin();
  const total = PAYMENTS.filter((p) => p.status === 'paid').reduce((a, p) => a + p.amount, 0);
  const pending = PAYMENTS.filter((p) => p.status === 'pending').reduce((a, p) => a + p.amount, 0);
  const sales = PAYMENTS.filter((p) => p.status === 'paid').length;
  return (
    <div>
      <PageTitle>{aT(A.payments, lang)}</PageTitle>
      <div className="admin-statgrid" style={{ marginBottom: 22 }}>
        <Stat label={aT(A.revenue_mtd, lang)} value={bahtA(total)} />
        <Stat label={aT(A.pkg_sales, lang)} value={sales} sub={aT(A.this_week, lang)} />
        <Stat label={aT(A.pending, lang)} value={bahtA(pending)} accent={pending ? '#9A7B45' : undefined} />
        <Stat label={aT(A.new_members, lang)} value={3} accent="var(--a-sage-deep)" />
      </div>
      <div className="admin-table">
        <div className="admin-thead admin-pay-grid">
          <span>{aT(A.member, lang)}</span><span>{aT(A.pkg_sales, lang)}</span><span className="admin-hide-sm">{lang === 'th' ? 'วิธี' : 'Method'}</span><span style={{ textAlign: 'right' }}>{lang === 'th' ? 'ยอด' : 'Amount'}</span><span style={{ textAlign: 'right' }}>{aT(A.status, lang)}</span>
        </div>
        {PAYMENTS.map((p) => {
          const m = mem(p.member);
          return (
            <div key={p.id} className="admin-trow admin-pay-grid">
              <span style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                <Avatar id={p.member} size={32} />
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'block', fontFamily: "'Hanken Grotesk', sans-serif", fontSize: 13.5, fontWeight: 600, color: 'var(--a-ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{aT(m.name, lang)}</span>
                  <span style={{ fontFamily: "'Hanken Grotesk', sans-serif", fontSize: 11.5, color: 'var(--a-muted)' }}>{p.when}</span>
                </span>
              </span>
              <span style={{ fontFamily: "'Hanken Grotesk', sans-serif", fontSize: 13.5, fontWeight: 600, color: 'var(--a-ink)' }}>{p.pkg}</span>
              <span className="admin-hide-sm" style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: "'Hanken Grotesk', sans-serif", fontSize: 12.5, color: 'var(--a-ink-soft)' }}><span style={{ width: 18, height: 18, borderRadius: 5, background: '#1A3A6B', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 800 }}>P</span>{p.method}</span>
              <span style={{ textAlign: 'right', fontFamily: "'Schibsted Grotesk', sans-serif", fontWeight: 700, fontSize: 14.5, color: 'var(--a-ink)' }}>{bahtA(p.amount)}</span>
              <span style={{ textAlign: 'right' }}><Badge tone={p.status === 'paid' ? 'green' : 'amber'}>{aT(A[p.status], lang)}</Badge></span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ───────────────────────── Instructors ─────────────────────────
function InstructorsScreen() {
  const { lang } = useAdmin();
  const slots = ['07:00', '09:00', '11:00', '17:00', '18:30'];
  // map instructor -> today's classes
  const byInstr = Object.keys(AINSTR).map((k) => ({ k, classes: TODAY.filter((c) => c.instr === k) }));
  return (
    <div>
      <PageTitle sub={aT(A.today_long, lang)}>{aT(A.instructors, lang)}</PageTitle>
      <div className="admin-instr-grid">
        {byInstr.map(({ k, classes }) => {
          const ins = AINSTR[k];
          const totalP = classes.reduce((a, c) => a + c.roster.length, 0);
          return (
            <Card key={k}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                <Avatar id={k} size={48} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: "'Schibsted Grotesk','IBM Plex Sans Thai',sans-serif", fontWeight: 600, fontSize: 18, color: 'var(--a-ink)' }}>{aT(ins.name, lang)}</div>
                  <div style={{ fontFamily: "'Hanken Grotesk', sans-serif", fontSize: 12.5, color: 'var(--a-muted)' }}>{classes.length} {lang === 'th' ? 'คลาส' : 'classes'} · {totalP} {aT(A.attendees, lang).toLowerCase()}</div>
                </div>
              </div>
              {classes.length === 0 ? (
                <div style={{ padding: '18px', textAlign: 'center', borderRadius: 12, background: 'var(--a-cream-2)', fontFamily: "'Hanken Grotesk', sans-serif", fontSize: 13, color: 'var(--a-muted)' }}>{lang === 'th' ? 'วันนี้ไม่มีคลาส' : 'No classes today'}</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {classes.map((c) => {
                    const ty = ATYPES[c.type];
                    return (
                      <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '10px 12px', borderRadius: 12, border: '1px solid var(--a-line)' }}>
                        <span style={{ fontFamily: "'Schibsted Grotesk', sans-serif", fontWeight: 700, fontSize: 14.5, color: 'var(--a-ink)', width: 44 }}>{c.time}</span>
                        <Dot type={c.type} size={7} />
                        <span style={{ flex: 1, fontFamily: "'Hanken Grotesk', sans-serif", fontSize: 13.5, fontWeight: 600, color: 'var(--a-ink)' }}>{aT(ty.short, lang)}</span>
                        <span style={{ fontFamily: "'Hanken Grotesk', sans-serif", fontSize: 12.5, color: 'var(--a-muted)' }}>{c.roster.length}/{ty.cap}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}

const iconGhost = { width: 34, height: 34, borderRadius: 99, border: 'none', background: 'transparent', color: 'var(--a-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' };

function Segmented({ value, onChange, options }) {
  return (
    <div style={{ display: 'inline-flex', background: 'var(--a-cream-2)', borderRadius: 99, padding: 4, gap: 2 }}>
      {options.map(([k, label]) => (
        <button key={k} onClick={() => onChange(k)} style={{
          padding: '9px 20px', borderRadius: 99, border: 'none', cursor: 'pointer', fontFamily: "'Hanken Grotesk', sans-serif", fontSize: 13.5, fontWeight: 600,
          background: value === k ? 'var(--a-surface-2)' : 'transparent', color: value === k ? 'var(--a-ink)' : 'var(--a-muted)', boxShadow: value === k ? 'var(--a-shadow)' : 'none', transition: 'all .2s',
        }}>{label}</button>
      ))}
    </div>
  );
}

Object.assign(window, { BookingsAdminScreen, MembersScreen, MiniStat, PaymentsScreen, InstructorsScreen, Segmented, iconGhost });
