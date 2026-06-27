// admin-mobile-today.jsx — Today overview + Schedule (list + vertical gantt)
function MToday() {
  const { t, tt, lang, go, openClass } = useM();
  const totalAtt = TODAY.reduce((a, c) => a + c.roster.length, 0);
  const totalCheck = TODAY.reduce((a, c) => a + c.roster.filter((x) => x[1]).length, 0);
  const totalWait = TODAY.reduce((a, c) => a + c.wait.length, 0);
  const totalCap = TODAY.reduce((a, c) => a + ATYPES[c.type].cap, 0);

  return (
    <div style={{ padding: '4px 18px 26px' }}>
      {/* stat grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 22 }}>
        <MStat label={t('classes_today')} value={TODAY.length} />
        <MStat label={t('attendees')} value={totalAtt} sub={'/ ' + totalCap} />
        <MStat label={t('checked_in')} value={totalCheck} accent="var(--a-sage-deep)" />
        <MStat label={t('waitlisted')} value={totalWait} accent={totalWait ? '#9A7B45' : undefined} />
      </div>

      {/* quick actions */}
      <Eyebrow2 style={{ margin: '0 2px 10px' }}>{t('quick_actions')}</Eyebrow2>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 24 }}>
        <QuickAction icon="qr" label={t('new_sale')} onClick={() => go('pos')} dark />
        <QuickAction icon="plus" label={t('add_customer')} onClick={() => go('addCustomer')} />
        <QuickAction icon="calendar" label={t('new_class')} onClick={() => go('schedule')} />
        <QuickAction icon="users" label={t('instr_avail')} onClick={() => go('instructors')} />
      </div>

      {/* today's classes */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', margin: '0 2px 12px' }}>
        <Eyebrow2>{t('today_classes')}</Eyebrow2>
        <span onClick={() => go('schedule')} style={{ fontFamily: "'Hanken Grotesk',sans-serif", fontSize: 12.5, fontWeight: 600, color: 'var(--a-taupe-deep)', cursor: 'pointer' }}>{t('view_all')}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {TODAY.map((c) => {
          const ty = ATYPES[c.type]; const booked = c.roster.length; const checked = c.roster.filter((x) => x[1]).length;
          return (
            <div key={c.id} onClick={() => openClass(c.id)} style={mRow}>
              <div style={{ width: 50, flexShrink: 0, textAlign: 'left', borderRight: '1px solid var(--a-line)', paddingRight: 12 }}>
                <div style={{ fontFamily: "'Schibsted Grotesk',sans-serif", fontWeight: 700, fontSize: 18, color: 'var(--a-ink)', lineHeight: 1 }}>{c.time}</div>
                <div style={{ fontFamily: "'Hanken Grotesk',sans-serif", fontSize: 11, color: 'var(--a-muted)', marginTop: 3 }}>{c.dur}'</div>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 5 }}>
                  <Dot type={c.type} size={7} />
                  <span style={{ fontFamily: "'Schibsted Grotesk','IBM Plex Sans Thai',sans-serif", fontWeight: 600, fontSize: 15, color: 'var(--a-ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{tt(ty.label)}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: "'Hanken Grotesk',sans-serif", fontSize: 12, color: 'var(--a-ink-soft)' }}><Avatar id={c.instr} size={17} />{tt(AINSTR[c.instr].name)}</span>
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, flexShrink: 0 }}>
                <Badge tone={checked === booked && booked > 0 ? 'green' : 'neutral'}>{checked}/{booked}</Badge>
                {c.wait.length > 0 && <span style={{ fontFamily: "'Hanken Grotesk',sans-serif", fontSize: 10.5, fontWeight: 600, color: '#9A7B45' }}>+{c.wait.length} {t('waitlist').toLowerCase()}</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function QuickAction({ icon, label, onClick, dark }) {
  return (
    <button onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '15px 15px', borderRadius: 16, cursor: 'pointer', textAlign: 'left', border: dark ? 'none' : '1px solid var(--a-line)', background: dark ? 'var(--a-ink)' : 'var(--a-surface-2)', color: dark ? '#fff' : 'var(--a-ink)', boxShadow: 'var(--a-shadow)' }}>
      <div style={{ width: 36, height: 36, borderRadius: 11, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: dark ? 'rgba(255,255,255,0.14)' : 'var(--a-cream-2)', color: dark ? '#F1E9E0' : 'var(--a-taupe-deep)' }}><Icon name={icon} size={19} /></div>
      <span style={{ fontFamily: "'Hanken Grotesk',sans-serif", fontSize: 13.5, fontWeight: 600, lineHeight: 1.2 }}>{label}</span>
    </button>
  );
}

const mRow = { display: 'flex', alignItems: 'center', gap: 13, background: 'var(--a-surface-2)', border: '1px solid var(--a-line)', borderRadius: 16, padding: '13px 15px', cursor: 'pointer', boxShadow: 'var(--a-shadow)' };

// ═══════════════ SCHEDULE (list + gantt) ═══════════════
function MSchedule() {
  const { t, tt, lang, go, openClass } = useM();
  const [view, setView] = React.useState('list');
  const [day, setDay] = React.useState(1);

  return (
    <div>
      {/* sticky controls */}
      <div style={{ position: 'sticky', top: 0, zIndex: 10, background: 'var(--a-cream)' }}>
        {/* day strip */}
        <div style={{ display: 'flex', gap: 7, overflowX: 'auto', padding: '2px 18px 12px', scrollbarWidth: 'none' }}>
          {ASCHED.map((w) => {
            const on = day === w.date;
            return (
              <button key={w.date} onClick={() => setDay(w.date)} style={{ flexShrink: 0, width: 46, padding: '8px 0 9px', borderRadius: 13, cursor: 'pointer', border: '1px solid ' + (on ? 'transparent' : 'var(--a-line)'), background: on ? 'var(--a-ink)' : 'var(--a-surface-2)', color: on ? 'var(--a-cream)' : 'var(--a-ink)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                <span style={{ fontFamily: "'Hanken Grotesk',sans-serif", fontSize: 10, fontWeight: 600, textTransform: 'uppercase', opacity: 0.7 }}>{w.d}</span>
                <span style={{ fontFamily: "'Schibsted Grotesk',sans-serif", fontWeight: 700, fontSize: 18, lineHeight: 1 }}>{w.date}</span>
              </button>
            );
          })}
        </div>
        {/* view toggle */}
        <div style={{ display: 'flex', gap: 8, padding: '0 18px 12px', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--a-line)' }}>
          <div style={{ display: 'flex', background: 'var(--a-cream-2)', borderRadius: 99, padding: 3 }}>
            {[['list', t('list_view')], ['gantt', t('timeline_view')]].map(([k, lb]) => (
              <button key={k} onClick={() => setView(k)} style={{ padding: '7px 16px', borderRadius: 99, border: 'none', cursor: 'pointer', fontFamily: "'Hanken Grotesk',sans-serif", fontSize: 12.5, fontWeight: 600, background: view === k ? 'var(--a-surface-2)' : 'transparent', color: view === k ? 'var(--a-ink)' : 'var(--a-muted)', boxShadow: view === k ? 'var(--a-shadow)' : 'none' }}>{lb}</button>
            ))}
          </div>
          <button onClick={() => go('newClass')} style={{ ...mIconBtn, width: 40, background: 'var(--a-ink)', color: '#fff', border: 'none' }}><Icon name="plus" size={20} /></button>
        </div>
      </div>

      {view === 'list' ? <MScheduleList day={day} /> : <MGantt />}
    </div>
  );
}

function MScheduleList({ day }) {
  const { t, tt, go, openClass, openEditClass } = useM();
  const classes = day === 1 ? TODAY : sampleDayM(day);
  return (
    <div style={{ padding: '14px 18px 26px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      {classes.map((c) => {
        const ty = ATYPES[c.type]; const booked = (c.roster || []).length;
        return (
          <div key={c.id} style={mRow}>
            <div onClick={() => openClass(c.id)} style={{ display: 'flex', alignItems: 'center', gap: 14, flex: 1, minWidth: 0, cursor: 'pointer' }}>
              <div style={{ width: 50, flexShrink: 0, textAlign: 'left', borderRight: '1px solid var(--a-line)', paddingRight: 12 }}>
                <div style={{ fontFamily: "'Schibsted Grotesk',sans-serif", fontWeight: 700, fontSize: 17, color: 'var(--a-ink)', lineHeight: 1 }}>{c.time}</div>
                <div style={{ fontFamily: "'Hanken Grotesk',sans-serif", fontSize: 11, color: 'var(--a-muted)', marginTop: 3 }}>{c.dur}'</div>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 5 }}>
                  <Dot type={c.type} size={7} />
                  <span style={{ fontFamily: "'Schibsted Grotesk','IBM Plex Sans Thai',sans-serif", fontWeight: 600, fontSize: 15, color: 'var(--a-ink)' }}>{tt(ty.short)}</span>
                </div>
                <div style={{ fontFamily: "'Hanken Grotesk',sans-serif", fontSize: 12, color: 'var(--a-ink-soft)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  {c.instr ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><Avatar id={c.instr} size={16} />{tt(AINSTR[c.instr].name)}</span> : <span style={{ color: 'var(--a-muted)' }}>—</span>}
                  <span style={{ color: 'var(--a-line-strong)' }}>·</span><span>{booked}/{ty.cap}</span>
                </div>
              </div>
            </div>
            <button onClick={(e) => { e.stopPropagation(); openEditClass(c); }} style={{ width: 38, height: 38, flexShrink: 0, borderRadius: 11, border: '1px solid var(--a-line)', background: 'var(--a-surface)', color: 'var(--a-ink-soft)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="edit" size={17} /></button>
          </div>
        );
      })}
    </div>
  );
}
function sampleDayM(date) {
  const base = [
    { id: 'sg'+date+1, time: '08:00', dur: 50, type: 'group', instr: 'mai', roster: [['m1'],['m3']] },
    { id: 'sg'+date+2, time: '10:00', dur: 60, type: 'private', instr: 'nina', roster: [['m4']] },
    { id: 'sg'+date+3, time: '17:30', dur: 50, type: 'group', instr: 'ploy', roster: [['m8'],['m2'],['m5']] },
    { id: 'sg'+date+4, time: '18:30', dur: 50, type: 'group', instr: 'mai', roster: [['m7']] },
  ];
  return base.slice(0, 2 + (date % 3));
}

// ═══════════════ VERTICAL GANTT ═══════════════
function MGantt() {
  const { t, tt, lang } = useM();
  const HOUR_PX = 78;
  const instrs = Object.keys(AINSTR);
  const hours = [];
  for (let h = GANTT_START; h <= GANTT_END; h++) hours.push(h);
  const totalH = (GANTT_END - GANTT_START) * HOUR_PX;
  const yOf = (f) => (f - GANTT_START) * HOUR_PX;
  // current time line: 09:41
  const nowF = 9 + 41 / 60;

  return (
    <div style={{ padding: '14px 0 26px' }}>
      {/* instructor header (sticky-ish) */}
      <div style={{ display: 'flex', padding: '0 14px 10px', position: 'sticky', top: 0, background: 'var(--a-cream)', zIndex: 5 }}>
        <div style={{ width: 44, flexShrink: 0 }} />
        {instrs.map((k) => (
          <div key={k} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5 }}>
            <Avatar id={k} size={32} />
            <span style={{ fontFamily: "'Hanken Grotesk',sans-serif", fontSize: 11.5, fontWeight: 600, color: 'var(--a-ink)', whiteSpace: 'nowrap' }}>{tt(AINSTR[k].name)}</span>
          </div>
        ))}
      </div>

      {/* grid */}
      <div style={{ display: 'flex', padding: '0 14px', position: 'relative' }}>
        {/* hour axis */}
        <div style={{ width: 44, flexShrink: 0, position: 'relative', height: totalH }}>
          {hours.map((h) => (
            <div key={h} style={{ position: 'absolute', top: yOf(h) - 7, right: 8, fontFamily: "'Hanken Grotesk',sans-serif", fontSize: 11, fontWeight: 600, color: 'var(--a-muted)' }}>{String(h).padStart(2,'0')}:00</div>
          ))}
        </div>

        {/* lanes */}
        <div style={{ flex: 1, position: 'relative', height: totalH }}>
          {/* hour gridlines */}
          {hours.map((h) => (
            <div key={h} style={{ position: 'absolute', left: 0, right: 0, top: yOf(h), height: 1, background: 'var(--a-line)' }} />
          ))}
          {/* now line */}
          <div style={{ position: 'absolute', left: 0, right: 0, top: yOf(nowF), height: 2, background: 'var(--a-taupe)', zIndex: 4 }}>
            <div style={{ position: 'absolute', left: -4, top: -4, width: 9, height: 9, borderRadius: 99, background: 'var(--a-taupe)' }} />
          </div>

          {/* instructor columns */}
          <div style={{ position: 'absolute', inset: 0, display: 'flex', gap: 8 }}>
            {instrs.map((k) => (
              <div key={k} style={{ flex: 1, position: 'relative', borderLeft: '1px solid var(--a-line)' }}>
                {/* availability shading */}
                {(AVAIL_DAY[k] || []).map((rg, i) => {
                  const top = yOf(hhmmToFloat(rg[0])); const h = (hhmmToFloat(rg[1]) - hhmmToFloat(rg[0])) * HOUR_PX;
                  return <div key={i} style={{ position: 'absolute', left: 3, right: 3, top, height: h, background: 'rgba(140,154,126,0.1)', borderRadius: 8 }} />;
                })}
                {/* class blocks */}
                {GANTT_DAY.filter((g) => g.instr === k).map((g, i) => {
                  const top = yOf(hhmmToFloat(g.time)); const h = (g.dur / 60) * HOUR_PX;
                  const ty = ATYPES[g.type];
                  return (
                    <div key={i} style={{ position: 'absolute', left: 3, right: 3, top: top + 1.5, height: h - 3, background: 'var(--a-surface-2)', border: '1px solid var(--a-line)', borderLeft: '3px solid ' + ty.dot, borderRadius: 9, padding: '6px 7px', overflow: 'hidden', boxShadow: 'var(--a-shadow)', zIndex: 3 }}>
                      <div style={{ fontFamily: "'Schibsted Grotesk',sans-serif", fontWeight: 700, fontSize: 11, color: 'var(--a-ink)', lineHeight: 1 }}>{g.time}</div>
                      <div style={{ fontFamily: "'Hanken Grotesk','IBM Plex Sans Thai',sans-serif", fontSize: 11, fontWeight: 600, color: 'var(--a-ink-soft)', marginTop: 3, lineHeight: 1.1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{tt(ty.short)}</div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* legend */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', padding: '18px 18px 0' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: "'Hanken Grotesk',sans-serif", fontSize: 11.5, color: 'var(--a-muted)' }}><span style={{ width: 14, height: 10, borderRadius: 3, background: 'rgba(140,154,126,0.25)' }} />{t('available')}</span>
        {['group','private','duo','trio'].map((k) => (
          <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: "'Hanken Grotesk',sans-serif", fontSize: 11.5, color: 'var(--a-muted)' }}><Dot type={k} size={8} />{tt(ATYPES[k].short)}</span>
        ))}
      </div>
    </div>
  );
}

Object.assign(window, { MToday, QuickAction, mRow, MSchedule, MScheduleList, sampleDayM, MGantt });
