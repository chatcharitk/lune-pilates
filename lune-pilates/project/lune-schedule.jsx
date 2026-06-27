// lune-schedule.jsx — Class schedule (week view + filters)
function ScheduleScreen() {
  const { t, tt, lang, openClass } = useLune();
  const [day, setDay] = useState(1);
  const [filter, setFilter] = useState('all');

  const filters = ['all', 'group', 'private', 'duo', 'trio', 'rental'];
  let sessions = SESSIONS.filter((s) => s.day === day);
  if (filter !== 'all') sessions = sessions.filter((s) => s.type === filter);
  sessions.sort((a, b) => a.time.localeCompare(b.time));

  const groups = ['morning', 'afternoon', 'evening'].map((pod) => ({
    pod, items: sessions.filter((s) => partOfDay(s.time) === pod),
  })).filter((g) => g.items.length);

  return (
    <div>
      {/* sticky sub-header: month + week + filters */}
      <div style={{ position: 'sticky', top: 0, zIndex: 10, background: 'var(--cream)', paddingTop: 4 }}>
        <div style={{ padding: '4px 22px 2px' }}>
          <h1 style={{ margin: 0, fontFamily: 'var(--font-head)', fontWeight: 500, fontSize: 30, color: 'var(--ink)', letterSpacing: 0.2 }}>{t('nav_schedule')}</h1>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 22px 6px' }}>
          <span style={{ fontFamily: 'var(--font-body)', fontSize: 13.5, fontWeight: 600, color: 'var(--ink-soft)' }}>{tt(MONTH)}</span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button style={navArrow}><Icon name="chevL" size={17} /></button>
            <button style={navArrow}><Icon name="chevR" size={17} /></button>
          </div>
        </div>
        {/* day chips */}
        <div style={{ display: 'flex', gap: 8, overflowX: 'auto', padding: '6px 22px 12px', scrollbarWidth: 'none' }}>
          {WEEK.map((w) => {
            const on = day === w.d;
            return (
              <button key={w.d} onClick={() => setDay(w.d)} style={{
                flexShrink: 0, width: 50, padding: '9px 0 10px', borderRadius: 16, cursor: 'pointer',
                border: '1px solid ' + (on ? 'transparent' : 'var(--line)'),
                background: on ? 'var(--ink)' : 'var(--surface-2)',
                color: on ? 'var(--cream)' : 'var(--ink-soft)',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, transition: 'all .2s',
              }}>
                <span style={{ fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 600, letterSpacing: 0.4, textTransform: 'uppercase', opacity: on ? 0.75 : 0.65 }}>{tt(w.dow)}</span>
                <span style={{ fontFamily: 'var(--font-head)', fontWeight: 600, fontSize: 21, lineHeight: 1 }}>{w.date}</span>
                {w.today && <span style={{ width: 4, height: 4, borderRadius: 99, background: on ? 'var(--cream)' : 'var(--taupe)' }} />}
              </button>
            );
          })}
        </div>
        {/* filter chips */}
        <div style={{ display: 'flex', gap: 8, overflowX: 'auto', padding: '2px 22px 14px', scrollbarWidth: 'none', borderBottom: '1px solid var(--line)' }}>
          {filters.map((f) => (
            <Chip key={f} active={filter === f} onClick={() => setFilter(f)} dot={f !== 'all' ? f : null}>
              {f === 'all' ? t('filter_all') : tt(TYPES[f].short)}
            </Chip>
          ))}
        </div>
      </div>

      {/* sessions */}
      <div style={{ padding: '8px 22px 28px' }}>
        {groups.length === 0 && (
          <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--muted)' }}>
            <Sparkle size={26} color="var(--line-strong)" style={{ margin: '0 auto 14px' }} />
            <div style={{ fontFamily: 'var(--font-head)', fontWeight: 500, fontSize: 18, color: 'var(--ink-soft)' }}>{t('no_classes')}</div>
          </div>
        )}
        {groups.map((g) => (
          <div key={g.pod} style={{ marginBottom: 18 }}>
            <Eyebrow style={{ margin: '10px 2px 12px' }}>{t(g.pod)}</Eyebrow>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {g.items.map((s) => <SessionRow key={s.id} s={s} onClick={() => openClass(s.id)} />)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const navArrow = {
  width: 34, height: 34, borderRadius: 99, border: '1px solid var(--line)',
  background: 'var(--surface-2)', color: 'var(--ink-soft)', cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
};

function SessionRow({ s, onClick }) {
  const { t, tt, lang } = useLune();
  const ty = TYPES[s.type]; const full = isFull(s); const left = spotsLeft(s);
  const instr = s.instr ? INSTRUCTORS[s.instr] : null;
  return (
    <div onClick={onClick} style={{
      display: 'flex', alignItems: 'stretch', gap: 14, background: 'var(--surface-2)',
      border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)', padding: '15px 16px',
      cursor: 'pointer', boxShadow: 'var(--shadow-sm)', opacity: full ? 0.92 : 1,
    }}>
      {/* time */}
      <div style={{ width: 52, flexShrink: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', borderRight: '1px solid var(--line)', paddingRight: 12 }}>
        <span style={{ fontFamily: 'var(--font-head)', fontWeight: 600, fontSize: 16, color: 'var(--ink)', lineHeight: 1 }}>{s.time}</span>
        <span style={{ fontFamily: 'var(--font-body)', fontSize: 10.5, color: 'var(--muted)', marginTop: 4 }}>{s.dur}{t('min')}</span>
      </div>
      {/* body */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 4 }}>
          <TypeDot type={s.type} size={7} />
          <span style={{ fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 600, letterSpacing: 0.5, textTransform: 'uppercase', color: 'var(--muted)' }}>{tt(ty.short)}</span>
        </div>
        <div style={{ fontFamily: 'var(--font-head)', fontWeight: 600, fontSize: 19, lineHeight: 1.1, color: 'var(--ink)' }}>{tt(ty.label)}</div>
        {instr && (
          <div style={{ fontFamily: 'var(--font-body)', fontSize: 12.5, color: 'var(--ink-soft)', marginTop: 3 }}>{t('with_kru')} {tt(instr.name)}</div>
        )}
      </div>
      {/* status */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', justifyContent: 'center', flexShrink: 0, gap: 5 }}>
        {full ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '5px 10px', borderRadius: 99, background: 'var(--cream-2)', color: 'var(--rose)', fontFamily: 'var(--font-body)', fontSize: 11.5, fontWeight: 600 }}>
            {t('full')}
          </span>
        ) : (
          <span style={{ fontFamily: 'var(--font-body)', fontSize: 12.5, fontWeight: 600, color: left <= 1 ? 'var(--rose)' : 'var(--sage-deep)' }}>
            {left} {left === 1 ? t('spot_left') : t('spots_left')}
          </span>
        )}
        <Icon name="chevR" size={16} style={{ color: 'var(--muted)' }} />
      </div>
    </div>
  );
}

Object.assign(window, { ScheduleScreen, SessionRow });
