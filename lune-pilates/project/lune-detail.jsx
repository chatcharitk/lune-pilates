// lune-detail.jsx — Class detail + booking / waitlist flow
function ClassDetail() {
  const { t, tt, lang, back, selected, credits, book, go } = useLune();
  const s = SESSIONS.find((x) => x.id === selected) || (USER.next.sessionId === selected ? { id: selected, day: 1, time: USER.next.time, dur: USER.next.dur, type: USER.next.type, instr: null, booked: 1 } : SESSIONS[0]);
  const ty = TYPES[s.type];
  const full = isFull(s);
  const left = spotsLeft(s);
  const wd = WEEK[s.day - 1];
  const cost = s.type === 'private' ? 1.5 : s.type === 'rental' ? 1 : 1;

  const [chosen, setChosen] = useState(s.instr || 'mai');
  // reformer positions: Left / Middle / Right (by capacity). First `booked` are taken.
  const POS_KEYS = ty.cap === 1 ? ['pos_middle'] : ty.cap === 2 ? ['pos_left', 'pos_right'] : ['pos_left', 'pos_middle', 'pos_right'];
  const firstOpen = POS_KEYS.findIndex((_, i) => i >= s.booked);
  const [chosenPos, setChosenPos] = useState(firstOpen);
  const [sheet, setSheet] = useState(null); // confirm | success | waitlist | waitsuccess
  const instr = ty.selInstructor ? INSTRUCTORS[chosen] : (s.instr ? INSTRUCTORS[s.instr] : null);
  const dateStr = (lang === 'th' ? `${tt(wd.dow)} ${wd.date} มิ.ย.` : `${tt(wd.dow)} ${wd.date} Jun`);

  function confirmBook() {
    book(cost);
    setSheet('success');
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--cream)' }}>
      {/* scroll body */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {/* hero */}
        <div style={{ position: 'relative', height: 232, backgroundImage: `url(${(window.__resources&&window.__resources.studioHero)||'assets/studio-hero.jpg'})`, backgroundSize: 'cover', backgroundPosition: 'center 60%' }}>
          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(40,32,24,0.28) 0%, rgba(40,32,24,0) 34%, rgba(40,32,24,0.04) 70%, var(--cream) 100%)' }} />
          <div style={{ position: 'absolute', top: 52, left: 16, right: 16, display: 'flex', justifyContent: 'space-between' }}>
            <button onClick={back} style={glassBtn}><Icon name="chevL" size={20} /></button>
            <button style={glassBtn}><Icon name="share" size={18} /></button>
          </div>
        </div>

        <div style={{ padding: '0 22px 150px', marginTop: -34, position: 'relative' }}>
          {/* title */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '6px 13px', borderRadius: 99, background: 'var(--surface-2)', border: '1px solid var(--line)', boxShadow: 'var(--shadow-sm)' }}>
              <TypeDot type={s.type} size={8} />
              <span style={{ fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 600, letterSpacing: 0.4, color: 'var(--ink-soft)' }}>{tt(ty.short)}</span>
            </span>
          </div>
          <h1 style={{ margin: '0 0 4px', fontFamily: 'var(--font-head)', fontWeight: 600, fontSize: 34, lineHeight: 1.05, color: 'var(--ink)', letterSpacing: 0.2 }}>{tt(ty.label)}</h1>

          {/* fact grid */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 18 }}>
            <Fact icon="calendar" label={t('today')} value={`${s.time}–${endTime(s.time, s.dur)}`} sub={dateStr} />
            <Fact icon="clock" label={t('duration')} value={`${s.dur} ${t('min')}`} />
            <Fact icon="users" label={t('capacity')} value={`${ty.cap} ${ty.cap === 1 ? '' : ''}${t('people')}`} sub={s.type === 'group' ? `3 ${t('reformers')}` : null} />
            <Fact icon="pin" label={t('location')} value={lang === 'th' ? 'LUNE สตูดิโอ' : 'LUNE Studio'} sub={lang === 'th' ? 'ชั้น 3' : 'Level 3'} />
          </div>

          {/* reformer position picker — Left / Middle / Right */}
          <div style={{ marginTop: 16, background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)', padding: '16px 18px 18px', boxShadow: 'var(--shadow-sm)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <Eyebrow>{full ? t('spots_remaining') : t('choose_position')}</Eyebrow>
              <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 4, fontFamily: 'var(--font-body)' }}>
                <span style={{ fontSize: 16, fontWeight: 700, color: full ? 'var(--rose)' : 'var(--sage-deep)' }}>{full ? '0' : left}</span>
                <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>/ {ty.cap} {lang === 'th' ? 'ที่' : 'open'}</span>
              </span>
            </div>
            <div style={{ display: 'flex', gap: 9 }}>
              {POS_KEYS.map((posKey, i) => {
                const taken = i < s.booked;
                const sel = !taken && chosenPos === i;
                const status = taken ? 'pos_taken' : sel ? 'pos_selected' : 'pos_open';
                const statusColor = taken ? 'var(--muted)' : sel ? 'var(--taupe-deep)' : 'var(--sage-deep)';
                return (
                  <button
                    key={i}
                    onClick={() => { if (!taken) setChosenPos(i); }}
                    disabled={taken}
                    style={{
                      flex: 1, borderRadius: 14, padding: '13px 6px 11px', cursor: taken ? 'default' : 'pointer',
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7, position: 'relative',
                      border: '1.5px solid ' + (sel ? 'var(--taupe)' : taken ? 'transparent' : 'var(--line-strong)'),
                      borderStyle: taken || sel ? 'solid' : 'dashed',
                      background: sel ? 'var(--surface-2)' : taken ? 'var(--cream-2)' : 'transparent',
                      boxShadow: sel ? 'var(--shadow-sm)' : 'none', transition: 'all .18s ease',
                    }}>
                    {/* selected check badge */}
                    {sel && (
                      <span style={{ position: 'absolute', top: 7, right: 7, width: 17, height: 17, borderRadius: 99, background: 'var(--taupe)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Icon name="check" size={11} stroke={2.6} />
                      </span>
                    )}
                    {/* position label */}
                    <span style={{ fontFamily: 'var(--font-head)', fontWeight: 600, fontSize: 14, color: taken ? 'var(--muted)' : 'var(--ink)' }}>{t(posKey)}</span>
                    {/* abstract reformer: carriage on two rails */}
                    <div style={{ width: '100%', maxWidth: 46, position: 'relative', height: 20 }}>
                      <div style={{ position: 'absolute', top: 3, left: 0, right: 0, height: 1.5, background: taken ? 'var(--muted)' : 'var(--taupe)', opacity: 0.42, borderRadius: 2 }} />
                      <div style={{ position: 'absolute', bottom: 3, left: 0, right: 0, height: 1.5, background: taken ? 'var(--muted)' : 'var(--taupe)', opacity: 0.42, borderRadius: 2 }} />
                      <div style={{
                        position: 'absolute', top: 0, bottom: 0,
                        left: taken ? '36%' : sel ? '35%' : '8%', width: '30%', borderRadius: 4,
                        background: taken ? 'var(--muted)' : 'var(--taupe)', opacity: taken ? 0.9 : sel ? 1 : 0.7,
                        transition: 'left .3s ease',
                      }} />
                    </div>
                    <span style={{ fontFamily: 'var(--font-body)', fontSize: 10.5, fontWeight: 600, letterSpacing: 0.2, color: statusColor }}>
                      {t(status)}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* instructor */}
          {ty.selInstructor ? (
            <div style={{ marginTop: 22 }}>
              <Eyebrow style={{ marginBottom: 12 }}>{t('select_instructor')}</Eyebrow>
              <div style={{ display: 'flex', gap: 10 }}>
                {Object.values(INSTRUCTORS).map((ins) => {
                  const on = chosen === ins.id;
                  return (
                    <button key={ins.id} onClick={() => setChosen(ins.id)} style={{
                      flex: 1, cursor: 'pointer', padding: '14px 8px 12px', borderRadius: 'var(--radius-sm)',
                      border: '1.5px solid ' + (on ? 'var(--taupe)' : 'var(--line)'),
                      background: on ? 'var(--surface-2)' : 'transparent',
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, transition: 'all .2s',
                    }}>
                      <Avatar ins={ins} on={on} />
                      <span style={{ fontFamily: 'var(--font-body)', fontSize: 12.5, fontWeight: 600, color: 'var(--ink)' }}>{tt(ins.name)}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : instr ? (
            <InstructorRow instr={instr} />
          ) : null}

          {/* about */}
          <div style={{ marginTop: 22 }}>
            <Eyebrow style={{ marginBottom: 8 }}>{t('about_class')}</Eyebrow>
            <p style={{ margin: 0, fontFamily: 'var(--font-body)', fontSize: 14.5, lineHeight: 1.62, color: 'var(--ink-soft)' }}>{tt(ty.blurb)}</p>
          </div>

          {/* policy */}
          <div style={{ marginTop: 18, display: 'flex', gap: 12, background: 'var(--cream-2)', borderRadius: 'var(--radius-sm)', padding: '15px 16px' }}>
            <div style={{ color: 'var(--taupe-deep)', flexShrink: 0, marginTop: 1 }}><Icon name="info" size={20} /></div>
            <div>
              <div style={{ fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 700, color: 'var(--ink)', marginBottom: 3 }}>{t('policy_title')}</div>
              <div style={{ fontFamily: 'var(--font-body)', fontSize: 13, lineHeight: 1.55, color: 'var(--ink-soft)' }}>{t('policy_body')}</div>
            </div>
          </div>
        </div>
      </div>

      {/* sticky footer CTA */}
      <div style={{ flexShrink: 0, padding: '14px 22px 30px', background: 'var(--surface-2)', borderTop: '1px solid var(--line)', boxShadow: '0 -10px 30px rgba(72,58,40,0.06)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ flexShrink: 0 }}>
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--muted)', letterSpacing: 0.3 }}>{t('costs')}</div>
            <div style={{ fontFamily: 'var(--font-head)', fontWeight: 600, fontSize: 22, color: 'var(--ink)', lineHeight: 1.1 }}>{cost} <span style={{ fontFamily: 'var(--font-body)', fontWeight: 500, fontSize: 13, color: 'var(--taupe)' }}>{cost === 1 ? t('hour') : t('hours')}</span></div>
          </div>
          <div style={{ flex: 1 }}>
            {full
              ? <PrimaryButton onClick={() => setSheet('waitlist')} icon="bell" variant="outline">{t('join_waitlist')}</PrimaryButton>
              : <PrimaryButton onClick={() => setSheet('confirm')} icon="arrowR">{t('book_now')}</PrimaryButton>}
          </div>
        </div>
      </div>

      {/* confirm sheet */}
      <Sheet open={sheet === 'confirm'} onClose={() => setSheet(null)}>
        <ConfirmContent s={s} ty={ty} instr={ty.selInstructor ? INSTRUCTORS[chosen] : instr} dateStr={dateStr} cost={cost} credits={credits} onConfirm={confirmBook} onCancel={() => setSheet(null)} />
      </Sheet>

      {/* success sheet */}
      <Sheet open={sheet === 'success'} onClose={() => { setSheet(null); go('bookings'); }} maxH="70%">
        <SuccessContent title={t('booked_title')} sub={t('booked_sub')} s={s} ty={ty} dateStr={dateStr} instr={ty.selInstructor ? INSTRUCTORS[chosen] : instr} showCal onDone={() => { setSheet(null); go('bookings'); }} />
      </Sheet>

      {/* waitlist sheet */}
      <Sheet open={sheet === 'waitlist'} onClose={() => setSheet(null)} maxH="64%">
        <WaitlistContent s={s} ty={ty} dateStr={dateStr} onConfirm={() => setSheet('waitsuccess')} onCancel={() => setSheet(null)} />
      </Sheet>
      <Sheet open={sheet === 'waitsuccess'} onClose={() => { setSheet(null); back(); }} maxH="60%">
        <SuccessContent title={t('waitlist_title')} sub={t('waitlist_sub')} s={s} ty={ty} dateStr={dateStr} waitlist onDone={() => { setSheet(null); back(); }} />
      </Sheet>
    </div>
  );
}

const glassBtn = {
  width: 40, height: 40, borderRadius: 99, cursor: 'pointer', border: '1px solid rgba(255,255,255,0.4)',
  background: 'rgba(255,255,255,0.5)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)',
  color: 'var(--ink)', display: 'flex', alignItems: 'center', justifyContent: 'center',
};

function Fact({ icon, label, value, sub }) {
  return (
    <div style={{ background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)', padding: '14px 15px', boxShadow: 'var(--shadow-sm)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, color: 'var(--taupe)', marginBottom: 9 }}>
        <Icon name={icon} size={17} />
        <span style={{ fontFamily: 'var(--font-body)', fontSize: 10.5, fontWeight: 600, letterSpacing: 0.8, textTransform: 'uppercase', color: 'var(--muted)' }}>{label}</span>
      </div>
      <div style={{ fontFamily: 'var(--font-head)', fontWeight: 600, fontSize: 18, color: 'var(--ink)', lineHeight: 1.1 }}>{value}</div>
      {sub && <div style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function Avatar({ ins, on, size = 44 }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: 99, display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: on ? 'var(--taupe)' : 'var(--cream-2)', color: on ? 'var(--surface-2)' : 'var(--taupe-deep)',
      fontFamily: 'var(--font-head)', fontWeight: 600, fontSize: size * 0.42, transition: 'all .2s',
    }}>{ins.initials}</div>
  );
}

function InstructorRow({ instr }) {
  const { t, tt } = useLune();
  return (
    <div style={{ marginTop: 22 }}>
      <Eyebrow style={{ marginBottom: 12 }}>{t('instructor')}</Eyebrow>
      <div style={{ display: 'flex', alignItems: 'center', gap: 13, background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)', padding: '13px 16px', boxShadow: 'var(--shadow-sm)' }}>
        <Avatar ins={instr} on />
        <div>
          <div style={{ fontFamily: 'var(--font-head)', fontWeight: 600, fontSize: 19, color: 'var(--ink)', lineHeight: 1.1 }}>{tt(instr.name)}</div>
          <div style={{ fontFamily: 'var(--font-body)', fontSize: 12.5, color: 'var(--ink-soft)', marginTop: 2 }}>{tt(instr.tag)}</div>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { ClassDetail, Fact, Avatar, InstructorRow, glassBtn });
