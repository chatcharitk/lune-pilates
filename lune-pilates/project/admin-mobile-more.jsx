// admin-mobile-more.jsx — More hub, Instructors+availability, Payments, Waitlist, roster
function MMore() {
  const { t, tt, lang, go } = useM();
  const rev = PAYMENTS.filter((p) => p.status === 'paid').reduce((a, p) => a + p.amount, 0);
  const items = [
    { key: 'analytics', icon: 'reformer', label: t('analytics_t'), sub: t('analytics_sub'), hero: true },
    { key: 'instructors', icon: 'users', label: t('instr_avail'), sub: lang === 'th' ? 'ตารางว่าง · ตารางสอน' : 'Availability · schedule' },
    { key: 'staff', icon: 'userPlus', label: t('team_staff'), sub: STAFF.length + (lang === 'th' ? ' คนในทีม' : ' team members') },
    { key: 'payments', icon: 'qr', label: t('payments'), sub: t('revenue_mtd') + ' · ' + bahtA(rev) },
    { key: 'waitlist', icon: 'bell', label: t('waitlist'), sub: lang === 'th' ? 'จัดการคิวรอ' : 'Manage the queue' },
    { key: 'addCustomer', icon: 'plus', label: t('add_customer'), sub: t('new_customer') },
  ];
  return (
    <div style={{ padding: '2px 18px 26px' }}>
      <Eyebrow2 style={{ margin: '0 2px 12px' }}>{t('manage_studio')}</Eyebrow2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {items.map((it) => (
          <button key={it.key} onClick={() => go(it.key)} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '15px 16px', borderRadius: 16, cursor: 'pointer', border: it.hero ? 'none' : '1px solid var(--a-line)', background: it.hero ? 'var(--a-ink)' : 'var(--a-surface-2)', boxShadow: 'var(--a-shadow)', textAlign: 'left' }}>
            <div style={{ width: 42, height: 42, borderRadius: 12, flexShrink: 0, background: it.hero ? 'rgba(243,236,226,0.14)' : 'var(--a-cream-2)', color: it.hero ? '#C9B89E' : 'var(--a-taupe-deep)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name={it.icon} size={20} /></div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: "'Schibsted Grotesk','IBM Plex Sans Thai',sans-serif", fontWeight: 600, fontSize: 16, color: it.hero ? '#F6EFE6' : 'var(--a-ink)' }}>{it.label}</div>
              <div style={{ fontFamily: "'Hanken Grotesk','IBM Plex Sans Thai',sans-serif", fontSize: 12.5, color: it.hero ? 'rgba(243,236,226,0.6)' : 'var(--a-muted)', marginTop: 2 }}>{it.sub}</div>
            </div>
            <Icon name="chevR" size={18} style={{ color: it.hero ? 'rgba(243,236,226,0.5)' : 'var(--a-muted)' }} />
          </button>
        ))}
      </div>

      {/* open full desktop analytics */}
      <a href="LUNE Admin Analytics.html" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '15px 16px', borderRadius: 16, marginTop: 18, border: '1px dashed var(--a-line-strong)', background: 'transparent', textDecoration: 'none' }}>
        <div style={{ width: 42, height: 42, borderRadius: 12, flexShrink: 0, background: 'var(--a-cream-2)', color: 'var(--a-taupe-deep)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="qr" size={20} /></div>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: "'Schibsted Grotesk','IBM Plex Sans Thai',sans-serif", fontWeight: 600, fontSize: 15, color: 'var(--a-ink)' }}>{lang === 'th' ? 'เปิดบนเดสก์ท็อป' : 'Open on desktop'}</div>
          <div style={{ fontFamily: "'Hanken Grotesk','IBM Plex Sans Thai',sans-serif", fontSize: 12, color: 'var(--a-muted)', marginTop: 2 }}>{lang === 'th' ? 'แดชบอร์ดเต็มรูปแบบ · iPad · เดสก์ท็อป' : 'Full dashboard · iPad · desktop'}</div>
        </div>
        <Icon name="arrowR" size={18} style={{ color: 'var(--a-muted)' }} />
      </a>
    </div>
  );
}

// ═══════════════ INSTRUCTORS + AVAILABILITY ═══════════════
function MInstructors({ onBack }) {
  const { t, tt, lang } = useM();
  const [editId, setEditId] = React.useState(null);
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--a-cream)' }}>
      <MHeader title={t('instr_avail')} onBack={onBack} />
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 18px 26px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {Object.keys(AINSTR).map((k) => {
            const ins = AINSTR[k];
            const todays = GANTT_DAY.filter((g) => g.instr === k);
            const todayRanges = AVAIL_DAY[k] || [];
            const offToday = todayRanges.length === 0;
            return (
              <div key={k} style={{ background: 'var(--a-surface-2)', border: '1px solid var(--a-line)', borderRadius: 18, padding: '16px 16px', boxShadow: 'var(--a-shadow)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
                  <Avatar id={k} size={46} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontFamily: "'Schibsted Grotesk','IBM Plex Sans Thai',sans-serif", fontWeight: 600, fontSize: 17, color: 'var(--a-ink)' }}>{tt(ins.name)}</div>
                    <div style={{ fontFamily: "'Hanken Grotesk','IBM Plex Sans Thai',sans-serif", fontSize: 12.5, color: 'var(--a-muted)', marginTop: 1 }}>{todays.length} {t('classes_n')} {lang === 'th' ? 'วันนี้' : 'today'}</div>
                  </div>
                  {offToday ? <Badge tone="rose">{t('day_off')}</Badge> : <Badge tone="green">{t('available')}</Badge>}
                </div>
                {/* today's available ranges */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
                  <span style={{ fontFamily: "'Hanken Grotesk',sans-serif", fontSize: 11.5, fontWeight: 600, color: 'var(--a-muted)' }}>{lang === 'th' ? 'วันนี้' : 'Today'}</span>
                  {offToday ? <span style={{ fontFamily: "'Hanken Grotesk','IBM Plex Sans Thai',sans-serif", fontSize: 13, color: 'var(--a-muted)' }}>— {t('day_off')}</span> : todayRanges.map((rg, i) => (
                    <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 11px', borderRadius: 99, background: 'rgba(140,154,126,0.14)', color: 'var(--a-sage-deep)', fontFamily: "'Hanken Grotesk',sans-serif", fontSize: 12.5, fontWeight: 600 }}><Icon name="clock" size={12} />{rg[0]}–{rg[1]}</span>
                  ))}
                </div>
                <button onClick={() => setEditId(k)} style={{ width: '100%', height: 44, borderRadius: 12, border: '1px solid var(--a-line-strong)', background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontFamily: "'Hanken Grotesk','IBM Plex Sans Thai',sans-serif", fontSize: 13.5, fontWeight: 600, color: 'var(--a-ink)' }}><Icon name="calendar" size={17} />{t('edit_avail')}</button>
              </div>
            );
          })}
        </div>
      </div>

      <MSheet open={!!editId} onClose={() => setEditId(null)} maxH="88%">
        {editId && <MAvailEditor id={editId} onClose={() => setEditId(null)} />}
      </MSheet>
    </div>
  );
}

function MAvailEditor({ id, onClose }) {
  const { t, tt, lang } = useM();
  const [week, setWeek] = React.useState(() => JSON.parse(JSON.stringify(AVAIL_WEEK[id])));
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const presets = [['07:00', '13:00'], ['17:00', '20:00'], ['09:00', '12:00']];

  function toggleDay(d) {
    setWeek((w) => ({ ...w, [d]: w[d].length ? [] : [['09:00', '12:00']] }));
  }
  function addRange(d) {
    setWeek((w) => ({ ...w, [d]: [...w[d], presets[w[d].length % presets.length]] }));
  }
  function removeRange(d, i) {
    setWeek((w) => ({ ...w, [d]: w[d].filter((_, idx) => idx !== i) }));
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
        <Avatar id={id} size={42} />
        <div>
          <h2 style={{ margin: 0, fontFamily: "'Schibsted Grotesk','IBM Plex Sans Thai',sans-serif", fontWeight: 600, fontSize: 20, color: 'var(--a-ink)' }}>{tt(AINSTR[id].name)}</h2>
          <div style={{ fontFamily: "'Hanken Grotesk','IBM Plex Sans Thai',sans-serif", fontSize: 12.5, color: 'var(--a-muted)' }}>{t('edit_avail')}</div>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
        {days.map((d) => {
          const ranges = week[d]; const off = ranges.length === 0;
          return (
            <div key={d} style={{ padding: '12px 14px', borderRadius: 14, border: '1px solid var(--a-line)', background: off ? 'transparent' : 'var(--a-surface-2)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontFamily: "'Schibsted Grotesk','IBM Plex Sans Thai',sans-serif", fontWeight: 600, fontSize: 15, color: off ? 'var(--a-muted)' : 'var(--a-ink)' }}>{lang === 'th' ? DAYS_TH[d] : d}</span>
                {/* toggle */}
                <button onClick={() => toggleDay(d)} style={{ width: 46, height: 27, borderRadius: 99, border: 'none', cursor: 'pointer', background: off ? 'var(--a-cream-2)' : 'var(--a-sage)', position: 'relative', transition: 'background .2s' }}>
                  <span style={{ position: 'absolute', top: 3, left: off ? 3 : 22, width: 21, height: 21, borderRadius: 99, background: '#fff', transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }} />
                </button>
              </div>
              {!off && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 11 }}>
                  {ranges.map((rg, i) => (
                    <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 8px 6px 11px', borderRadius: 99, background: 'rgba(140,154,126,0.14)', color: 'var(--a-sage-deep)', fontFamily: "'Hanken Grotesk',sans-serif", fontSize: 12.5, fontWeight: 600 }}>
                      {rg[0]}–{rg[1]}
                      <button onClick={() => removeRange(d, i)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--a-sage-deep)', display: 'flex', padding: 0 }}><Icon name="x" size={13} /></button>
                    </span>
                  ))}
                  <button onClick={() => addRange(d)} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '6px 11px', borderRadius: 99, border: '1px dashed var(--a-line-strong)', background: 'transparent', cursor: 'pointer', fontFamily: "'Hanken Grotesk','IBM Plex Sans Thai',sans-serif", fontSize: 12.5, fontWeight: 600, color: 'var(--a-ink-soft)' }}><Icon name="plus" size={13} />{t('add_hours')}</button>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div style={{ marginTop: 18 }}><MPrimary onClick={onClose} icon="check">{t('save')}</MPrimary></div>
    </div>
  );
}

// ═══════════════ PAYMENTS ═══════════════
function MPayments({ onBack }) {
  const { t, tt, lang } = useM();
  const total = PAYMENTS.filter((p) => p.status === 'paid').reduce((a, p) => a + p.amount, 0);
  const pending = PAYMENTS.filter((p) => p.status === 'pending').reduce((a, p) => a + p.amount, 0);
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--a-cream)' }}>
      <MHeader title={t('payments')} onBack={onBack} />
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 18px 26px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 20 }}>
          <MStat label={t('revenue_mtd')} value={bahtA(total)} />
          <MStat label={t('pending')} value={bahtA(pending)} accent={pending ? '#9A7B45' : undefined} />
        </div>
        <Eyebrow2 style={{ margin: '0 2px 12px' }}>{lang === 'th' ? 'รายการล่าสุด' : 'Recent transactions'}</Eyebrow2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
          {PAYMENTS.map((p) => {
            const m = cust(p.member);
            return (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 12, background: 'var(--a-surface-2)', border: '1px solid var(--a-line)', borderRadius: 15, padding: '12px 14px', boxShadow: 'var(--a-shadow)' }}>
                <Avatar id={p.member} size={38} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: "'Hanken Grotesk','IBM Plex Sans Thai',sans-serif", fontSize: 14, fontWeight: 600, color: 'var(--a-ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m ? tt(m.name) : '—'}</div>
                  <div style={{ fontFamily: "'Hanken Grotesk',sans-serif", fontSize: 12, color: 'var(--a-muted)', marginTop: 1 }}>{p.pkg} · {p.when}</div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontFamily: "'Schibsted Grotesk',sans-serif", fontWeight: 700, fontSize: 14.5, color: 'var(--a-ink)' }}>{bahtA(p.amount)}</div>
                  <div style={{ marginTop: 3 }}><Badge tone={p.status === 'paid' ? 'green' : 'amber'}>{t(p.status)}</Badge></div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ═══════════════ WAITLIST ═══════════════
function MWaitlist({ onBack }) {
  const { t, tt, lang } = useM();
  const classesWithWait = TODAY.filter((c) => c.wait.length);
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--a-cream)' }}>
      <MHeader title={t('waitlist')} onBack={onBack} />
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 18px 26px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {classesWithWait.map((c) => {
            const ty = ATYPES[c.type];
            return (
              <div key={c.id} style={{ background: 'var(--a-surface-2)', border: '1px solid var(--a-line)', borderRadius: 18, padding: '15px 16px', boxShadow: 'var(--a-shadow)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 13, flexWrap: 'wrap' }}>
                  <Dot type={c.type} size={8} />
                  <span style={{ fontFamily: "'Schibsted Grotesk','IBM Plex Sans Thai',sans-serif", fontWeight: 600, fontSize: 15.5, color: 'var(--a-ink)' }}>{tt(ty.label)}</span>
                  <span style={{ fontFamily: "'Hanken Grotesk','IBM Plex Sans Thai',sans-serif", fontSize: 12.5, color: 'var(--a-muted)' }}>{lang === 'th' ? 'วันนี้' : 'Today'} · {c.time}</span>
                  <Badge tone="rose">{t('full')}</Badge>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {WAITLIST.filter((w) => w.cls === c.id).map((w, i) => {
                    const m = cust(w.member);
                    return (
                      <div key={w.id} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '10px 12px', borderRadius: 13, background: w.state === 'notified' ? 'rgba(193,160,121,0.1)' : 'var(--a-surface)', border: '1px solid ' + (w.state === 'notified' ? 'rgba(193,160,121,0.32)' : 'var(--a-line)') }}>
                        <span style={{ fontFamily: "'Schibsted Grotesk',sans-serif", fontWeight: 700, fontSize: 14, color: 'var(--a-muted)', width: 14 }}>{i + 1}</span>
                        <Avatar id={w.member} size={34} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontFamily: "'Hanken Grotesk','IBM Plex Sans Thai',sans-serif", fontSize: 13.5, fontWeight: 600, color: 'var(--a-ink)' }}>{tt(m.name)}</div>
                          <div style={{ fontFamily: "'Hanken Grotesk',sans-serif", fontSize: 11.5, color: 'var(--a-muted)' }}>{m.member ? t('member') : t('guest')}</div>
                        </div>
                        {w.state === 'notified'
                          ? <Badge tone="amber"><Icon name="clock" size={12} />{w.mins}m</Badge>
                          : <button style={{ display: 'inline-flex', alignItems: 'center', gap: 5, height: 34, padding: '0 13px', borderRadius: 10, border: '1px solid var(--a-line-strong)', background: 'transparent', cursor: 'pointer', fontFamily: "'Hanken Grotesk','IBM Plex Sans Thai',sans-serif", fontSize: 12.5, fontWeight: 600, color: 'var(--a-ink)' }}><Icon name="bell" size={14} />{t('notify')}</button>}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ═══════════════ CLASS ROSTER (check-in) ═══════════════
function MRoster({ clsId, onClose }) {
  const { t, tt, lang } = useM();
  const cls = TODAY.find((c) => c.id === clsId);
  const [roster, setRoster] = React.useState(() => (cls ? cls.roster.map((r) => [...r]) : []));
  if (!cls) return null;
  const ty = ATYPES[cls.type];
  function toggle(i) { setRoster((r) => r.map((x, idx) => idx === i ? [x[0], !x[1]] : x)); }
  const checked = roster.filter((x) => x[1]).length;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, padding: '12px 14px', borderRadius: 14, background: 'var(--a-cream-2)' }}>
        <Dot type={cls.type} size={9} />
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: "'Schibsted Grotesk','IBM Plex Sans Thai',sans-serif", fontWeight: 600, fontSize: 16, color: 'var(--a-ink)' }}>{tt(ty.label)}</div>
          <div style={{ fontFamily: "'Hanken Grotesk','IBM Plex Sans Thai',sans-serif", fontSize: 12.5, color: 'var(--a-muted)' }}>{cls.time}–{endTM(cls.time, cls.dur)} · {tt(AINSTR[cls.instr].name)}</div>
        </div>
        <Badge tone={checked === roster.length && roster.length ? 'green' : 'neutral'}>{checked}/{roster.length}</Badge>
      </div>
      <Eyebrow2 style={{ marginBottom: 10 }}>{t('roster')}</Eyebrow2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {roster.map((r, i) => {
          const m = cust(r[0]);
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: 13, border: '1px solid var(--a-line)', background: r[1] ? 'rgba(140,154,126,0.08)' : 'var(--a-surface)' }}>
              <Avatar id={r[0]} size={38} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ fontFamily: "'Hanken Grotesk','IBM Plex Sans Thai',sans-serif", fontSize: 14, fontWeight: 600, color: 'var(--a-ink)' }}>{tt(m.name)}</span>{m.member && <Sparkle size={10} color="var(--a-taupe)" />}</div>
                <div style={{ fontFamily: "'Hanken Grotesk',sans-serif", fontSize: 12, color: 'var(--a-muted)' }}>{m.phone}</div>
              </div>
              <button onClick={() => toggle(i)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 36, padding: '0 13px', borderRadius: 10, cursor: 'pointer', border: r[1] ? 'none' : '1px solid var(--a-line-strong)', background: r[1] ? 'var(--a-sage)' : 'transparent', color: r[1] ? '#fff' : 'var(--a-ink)', fontFamily: "'Hanken Grotesk','IBM Plex Sans Thai',sans-serif", fontSize: 12.5, fontWeight: 600 }}><Icon name="check" size={14} stroke={2.4} />{r[1] ? t('checked') : t('check_in')}</button>
            </div>
          );
        })}
        {cls.wait.length > 0 && (
          <div style={{ marginTop: 8 }}>
            <Eyebrow2 style={{ marginBottom: 10, color: '#9A7B45' }}>{t('waitlist')} · {cls.wait.length}</Eyebrow2>
            {cls.wait.map((w, i) => {
              const m = cust(w[0]);
              return (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '10px 12px', borderRadius: 13, border: '1px dashed var(--a-line-strong)', marginBottom: 8 }}>
                  <span style={{ fontFamily: "'Schibsted Grotesk',sans-serif", fontWeight: 700, fontSize: 13, color: 'var(--a-muted)', width: 14 }}>{i + 1}</span>
                  <Avatar id={w[0]} size={32} />
                  <span style={{ flex: 1, fontFamily: "'Hanken Grotesk','IBM Plex Sans Thai',sans-serif", fontSize: 13.5, fontWeight: 600, color: 'var(--a-ink)' }}>{tt(m.name)}</span>
                  <button style={{ display: 'inline-flex', alignItems: 'center', gap: 5, height: 34, padding: '0 12px', borderRadius: 10, border: '1px solid var(--a-line-strong)', background: 'transparent', cursor: 'pointer', fontFamily: "'Hanken Grotesk','IBM Plex Sans Thai',sans-serif", fontSize: 12, fontWeight: 600, color: 'var(--a-ink)' }}><Icon name="bell" size={13} />{t('notify')}</button>
                </div>
              );
            })}
          </div>
        )}
      </div>
      <div style={{ marginTop: 18 }}><MPrimary onClick={onClose} tone="sage" icon="check">{t('done2')}</MPrimary></div>
    </div>
  );
}

// ═══════════════ STAFF & TEAM ═══════════════
function MStaff({ onBack }) {
  const { t, tt, lang, go } = useM();
  const roleTone = { role_instr: 'ink', role_desk: 'neutral', role_mgr: 'green' };
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--a-cream)' }}>
      <MHeader title={t('team_staff')} onBack={onBack} right={<button onClick={() => go('addStaff')} style={{ ...mIconBtn, width: 40, background: 'var(--a-ink)', color: '#fff', border: 'none' }}><Icon name="userPlus" size={19} /></button>} />
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 18px 26px' }}>
        <Eyebrow2 style={{ margin: '0 2px 12px' }}>{t('active_team')} · {STAFF.length}</Eyebrow2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {STAFF.map((s) => (
            <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 13, background: 'var(--a-surface-2)', border: '1px solid var(--a-line)', borderRadius: 16, padding: '14px 15px', boxShadow: 'var(--a-shadow)' }}>
              <Avatar id={s.id} size={46} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: "'Schibsted Grotesk','IBM Plex Sans Thai',sans-serif", fontWeight: 600, fontSize: 16, color: 'var(--a-ink)' }}>{tt(staffName(s))}</div>
                <div style={{ fontFamily: "'Hanken Grotesk','IBM Plex Sans Thai',sans-serif", fontSize: 12.5, color: 'var(--a-muted)', marginTop: 2 }}>{tt(s.specialty)}</div>
              </div>
              <Badge tone={roleTone[s.role] || 'neutral'}>{t(s.role)}</Badge>
            </div>
          ))}
        </div>
        <button onClick={() => go('addStaff')} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9, width: '100%', marginTop: 14, height: 50, borderRadius: 14, border: '1px dashed var(--a-line-strong)', background: 'transparent', cursor: 'pointer', fontFamily: "'Hanken Grotesk','IBM Plex Sans Thai',sans-serif", fontSize: 14, fontWeight: 600, color: 'var(--a-ink-soft)' }}><Icon name="userPlus" size={18} />{t('add_staff')}</button>
      </div>
    </div>
  );
}

// ── Add staff form ──
function MAddStaff({ onBack }) {
  const { t, tt, lang } = useM();
  const [name, setName] = React.useState('');
  const [phone, setPhone] = React.useState('');
  const [role, setRole] = React.useState('role_instr');
  const [spec, setSpec] = React.useState('');
  const [done, setDone] = React.useState(false);
  const valid = name.trim() && phone.trim().length >= 9;
  const roles = [['role_instr', 'users'], ['role_desk', 'qr'], ['role_mgr', 'person']];

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--a-cream)' }}>
      <MHeader title={t('new_staff')} onBack={onBack} />
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 18px 30px' }}>
        <FieldM label={t('full_name')}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={lang === 'th' ? 'เช่น ครูแนน' : 'e.g. Kru Nan'} style={inputM} />
        </FieldM>
        <FieldM label={t('phone')}>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="08X XXX XXXX" style={inputM} />
        </FieldM>
        <FieldM label={t('role')}>
          <div style={{ display: 'flex', gap: 8 }}>
            {roles.map(([k, ic]) => {
              const on = role === k;
              return (
                <button key={k} onClick={() => setRole(k)} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7, padding: '14px 6px', borderRadius: 13, cursor: 'pointer', border: '1.5px solid ' + (on ? 'var(--a-taupe)' : 'var(--a-line)'), background: on ? 'var(--a-surface-2)' : 'transparent' }}>
                  <div style={{ width: 36, height: 36, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', background: on ? 'var(--a-ink)' : 'var(--a-cream-2)', color: on ? '#fff' : 'var(--a-taupe-deep)' }}><Icon name={ic} size={18} /></div>
                  <span style={{ fontFamily: "'Hanken Grotesk','IBM Plex Sans Thai',sans-serif", fontSize: 12.5, fontWeight: 600, color: 'var(--a-ink)' }}>{t(k)}</span>
                </button>
              );
            })}
          </div>
        </FieldM>
        <FieldM label={t('specialty')} hint={t('optional')}>
          <input value={spec} onChange={(e) => setSpec(e.target.value)} placeholder={lang === 'th' ? 'เช่น ฟื้นฟู · ก่อน/หลังคลอด' : 'e.g. Rehab · Prenatal'} style={inputM} />
        </FieldM>
      </div>
      <div style={{ flexShrink: 0, padding: '14px 18px 30px', background: 'var(--a-surface-2)', borderTop: '1px solid var(--a-line)' }}>
        <MPrimary onClick={() => valid && setDone(true)} disabled={!valid} icon="check">{t('save_staff')}</MPrimary>
      </div>
      <MSheet open={done} onClose={onBack} maxH="58%">
        <div style={{ textAlign: 'center', paddingTop: 8 }}>
          <div style={{ width: 72, height: 72, borderRadius: 99, margin: '4px auto 16px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--a-sage)', color: '#fff', boxShadow: '0 10px 28px rgba(140,154,126,0.4)' }}><Icon name="check" size={34} stroke={2} /></div>
          <h2 style={{ margin: '0 0 8px', fontFamily: "'Schibsted Grotesk','IBM Plex Sans Thai',sans-serif", fontWeight: 600, fontSize: 25, color: 'var(--a-ink)' }}>{t('staff_added')}</h2>
          <p style={{ margin: '0 auto 20px', maxWidth: 260, fontFamily: "'Hanken Grotesk','IBM Plex Sans Thai',sans-serif", fontSize: 14, color: 'var(--a-ink-soft)' }}><strong>{name || (lang === 'th' ? 'ทีมงาน' : 'Staff')}</strong> · {t(role)} {t('staff_added_sub')}</p>
          <MPrimary onClick={onBack}>{t('done2')}</MPrimary>
        </div>
      </MSheet>
    </div>
  );
}

Object.assign(window, { MMore, MInstructors, MAvailEditor, MPayments, MWaitlist, MRoster, MStaff, MAddStaff });
