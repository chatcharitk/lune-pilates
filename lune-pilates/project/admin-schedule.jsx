// admin-schedule.jsx — Schedule management + new/edit class drawer
function ScheduleAdminScreen() {
  const { lang } = useAdmin();
  const [day, setDay] = useState(1);
  const [editing, setEditing] = useState(null); // 'new' | class object

  const dayClasses = day === 1 ? TODAY : sampleDay(day);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 18, flexWrap: 'wrap' }}>
        <PageTitle sub={lang === 'th' ? 'มิถุนายน 2569' : 'June 2026'}>{aT(A.schedule, lang)}</PageTitle>
        <Btn icon="plus" onClick={() => setEditing('new')}>{aT(A.new_class, lang)}</Btn>
      </div>

      {/* week strip */}
      <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 6, marginBottom: 18 }}>
        {ASCHED.map((w) => {
          const on = day === w.date;
          return (
            <button key={w.date} onClick={() => setDay(w.date)} style={{
              flexShrink: 0, minWidth: 76, padding: '12px 14px', borderRadius: 14, cursor: 'pointer', textAlign: 'left',
              border: '1px solid ' + (on ? 'transparent' : 'var(--a-line)'), background: on ? 'var(--a-ink)' : 'var(--a-surface-2)', color: on ? 'var(--a-cream)' : 'var(--a-ink)', transition: 'all .2s',
            }}>
              <div style={{ fontFamily: "'Hanken Grotesk', sans-serif", fontSize: 11.5, fontWeight: 600, letterSpacing: 0.5, textTransform: 'uppercase', opacity: 0.7 }}>{w.d}</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 3 }}>
                <span style={{ fontFamily: "'Schibsted Grotesk', sans-serif", fontWeight: 700, fontSize: 22, lineHeight: 1 }}>{w.date}</span>
                <span style={{ fontFamily: "'Hanken Grotesk', sans-serif", fontSize: 11, opacity: 0.7 }}>{w.classes} {lang === 'th' ? 'คลาส' : 'cls'}</span>
              </div>
            </button>
          );
        })}
      </div>

      {/* class list for the day */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {dayClasses.map((c) => {
          const ty = ATYPES[c.type]; const booked = (c.roster || []).length;
          return (
            <Card key={c.id} pad={0} style={{ overflow: 'hidden' }}>
              <div className="admin-classrow">
                <div className="admin-classtime">
                  <div style={{ fontFamily: "'Schibsted Grotesk', sans-serif", fontWeight: 700, fontSize: 19, color: 'var(--a-ink)', lineHeight: 1 }}>{c.time}</div>
                  <div style={{ fontFamily: "'Hanken Grotesk', sans-serif", fontSize: 11, color: 'var(--a-muted)', marginTop: 3 }}>{c.dur}'</div>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5, flexWrap: 'wrap' }}>
                    <Dot type={c.type} size={8} />
                    <span style={{ fontFamily: "'Schibsted Grotesk','IBM Plex Sans Thai',sans-serif", fontWeight: 600, fontSize: 15.5, color: 'var(--a-ink)' }}>{aT(ty.label, lang)}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: "'Hanken Grotesk', sans-serif", fontSize: 12.5, color: 'var(--a-ink-soft)' }}>
                    {c.instr ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Avatar id={c.instr} size={18} />{aT(AINSTR[c.instr].name, lang)}</span> : <span style={{ color: 'var(--a-muted)' }}>{lang === 'th' ? 'ไม่ระบุผู้สอน' : 'No instructor'}</span>}
                    <span style={{ color: 'var(--a-line-strong)' }}>·</span>
                    <span>{booked}/{ty.cap} {aT(A.booked, lang).toLowerCase()}</span>
                  </div>
                </div>
                <div className="admin-classmeta">
                  <Btn kind="ghost" size="sm" icon="filter" onClick={() => setEditing(c)}>{aT(A.edit, lang)}</Btn>
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      <ClassEditor open={!!editing} editing={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

function sampleDay(date) {
  // deterministic small set for non-today days
  const base = [
    { id: 'g' + date + 1, time: '08:00', dur: 50, type: 'group', instr: 'mai', roster: [['m1'], ['m3']] },
    { id: 'g' + date + 2, time: '10:00', dur: 60, type: 'private', instr: 'nina', roster: [['m4']] },
    { id: 'g' + date + 3, time: '17:30', dur: 50, type: 'group', instr: 'ploy', roster: [['m8'], ['m2'], ['m5']] },
    { id: 'g' + date + 4, time: '18:30', dur: 50, type: 'group', instr: 'mai', roster: [['m7']] },
  ];
  return base.slice(0, 2 + (date % 3));
}

function ClassEditor({ open, editing, onClose }) {
  const { lang } = useAdmin();
  const isNew = editing === 'new';
  const c = isNew || !editing ? null : editing;
  const [type, setType] = useState('group');
  const [time, setTime] = useState('07:00');
  const [dur, setDur] = useState(50);
  const [instr, setInstr] = useState('mai');
  const [cap, setCap] = useState(3);

  useEffect(() => {
    if (c) { setType(c.type); setTime(c.time); setDur(c.dur); setInstr(c.instr || 'mai'); setCap(ATYPES[c.type].cap); }
    else { setType('group'); setTime('07:00'); setDur(50); setInstr('mai'); setCap(3); }
  }, [editing]);

  const selInstr = type === 'private' || type === 'duo' || type === 'trio';

  return (
    <Drawer open={open} onClose={onClose}
      title={isNew ? aT(A.new_class, lang) : aT(A.edit, lang)}
      footer={<>
        <Btn kind="ghost" onClick={onClose}>{aT(A.cancel, lang)}</Btn>
        <div style={{ flex: 1 }} />
        <Btn icon="check" onClick={onClose}>{aT(A.save, lang)}</Btn>
      </>}>
      <Field label={lang === 'th' ? 'ประเภทคลาส' : 'Class type'}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {Object.keys(ATYPES).map((k) => {
            const on = type === k;
            return (
              <button key={k} onClick={() => { setType(k); setCap(ATYPES[k].cap); }} style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '12px 13px', borderRadius: 12, cursor: 'pointer', textAlign: 'left',
                border: '1.5px solid ' + (on ? 'var(--a-taupe)' : 'var(--a-line)'), background: on ? 'var(--a-surface)' : 'transparent',
              }}>
                <Dot type={k} size={9} />
                <span style={{ fontFamily: "'Hanken Grotesk', sans-serif", fontSize: 13.5, fontWeight: 600, color: 'var(--a-ink)' }}>{aT(ATYPES[k].short, lang)}</span>
              </button>
            );
          })}
        </div>
      </Field>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <Field label={lang === 'th' ? 'เวลา' : 'Start time'}>
          <select value={time} onChange={(e) => setTime(e.target.value)} style={selectStyle}>
            {['07:00', '07:30', '08:00', '09:00', '09:30', '10:00', '11:00', '12:00', '17:00', '17:30', '18:00', '18:30', '19:00'].map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </Field>
        <Field label={lang === 'th' ? 'ระยะเวลา' : 'Duration'}>
          <select value={dur} onChange={(e) => setDur(+e.target.value)} style={selectStyle}>
            {[50, 60, 90].map((d) => <option key={d} value={d}>{d} {lang === 'th' ? 'นาที' : 'min'}</option>)}
          </select>
        </Field>
      </div>

      <Field label={aT(A.instructor, lang) + (selInstr ? '' : (lang === 'th' ? ' (เลือกได้)' : ' (optional)'))}>
        <div style={{ display: 'flex', gap: 8 }}>
          {Object.keys(AINSTR).map((k) => {
            const on = instr === k;
            return (
              <button key={k} onClick={() => setInstr(k)} style={{
                flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7, padding: '12px 6px', borderRadius: 12, cursor: 'pointer',
                border: '1.5px solid ' + (on ? 'var(--a-taupe)' : 'var(--a-line)'), background: on ? 'var(--a-surface)' : 'transparent',
              }}>
                <Avatar id={k} size={36} />
                <span style={{ fontFamily: "'Hanken Grotesk', sans-serif", fontSize: 12.5, fontWeight: 600, color: 'var(--a-ink)' }}>{aT(AINSTR[k].name, lang)}</span>
              </button>
            );
          })}
        </div>
      </Field>

      <Field label={aT(A.capacity, lang)}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 0, border: '1px solid var(--a-line-strong)', borderRadius: 12, overflow: 'hidden' }}>
            <button onClick={() => setCap((v) => Math.max(1, v - 1))} style={stepBtn}><Icon name="x" size={14} style={{ transform: 'rotate(45deg)' }} /></button>
            <span style={{ width: 48, textAlign: 'center', fontFamily: "'Schibsted Grotesk', sans-serif", fontWeight: 700, fontSize: 18, color: 'var(--a-ink)' }}>{cap}</span>
            <button onClick={() => setCap((v) => Math.min(3, v + 1))} style={stepBtn}><Icon name="plus" size={14} /></button>
          </div>
          <span style={{ fontFamily: "'Hanken Grotesk', sans-serif", fontSize: 13, color: 'var(--a-muted)' }}>{lang === 'th' ? 'คน · สูงสุด 3 เครื่อง' : 'people · max 3 reformers'}</span>
        </div>
      </Field>

      {!isNew && (
        <button onClick={onClose} style={{ width: '100%', marginTop: 8, padding: '13px', borderRadius: 12, border: '1px solid rgba(196,154,134,0.4)', background: 'transparent', color: '#A56A52', cursor: 'pointer', fontFamily: "'Hanken Grotesk', sans-serif", fontSize: 14, fontWeight: 600 }}>{lang === 'th' ? 'ลบคลาสนี้' : 'Delete class'}</button>
      )}
    </Drawer>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ display: 'block', fontFamily: "'Hanken Grotesk', sans-serif", fontSize: 12, fontWeight: 600, letterSpacing: 0.3, color: 'var(--a-ink-soft)', marginBottom: 8 }}>{label}</label>
      {children}
    </div>
  );
}
const selectStyle = { width: '100%', height: 46, padding: '0 14px', borderRadius: 12, border: '1px solid var(--a-line-strong)', background: 'var(--a-surface)', color: 'var(--a-ink)', fontFamily: "'Hanken Grotesk', sans-serif", fontSize: 14, fontWeight: 500, cursor: 'pointer', appearance: 'none' };
const stepBtn = { width: 40, height: 44, border: 'none', background: 'var(--a-surface)', color: 'var(--a-ink)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' };

Object.assign(window, { ScheduleAdminScreen, ClassEditor, Field });
