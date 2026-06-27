// admin-today.jsx — Today's overview + roster check-in drawer
function endT(time, dur) {let [h, m] = time.split(':').map(Number);m += dur;h += Math.floor(m / 60);m %= 60;return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');}

function TodayScreen() {
  const { lang } = useAdmin();
  const [openCls, setOpenCls] = useState(null);
  const [rosters, setRosters] = useState(() => Object.fromEntries(TODAY.map((c) => [c.id, c.roster.map((r) => [...r])])));

  const totalAtt = Object.values(rosters).reduce((a, r) => a + r.length, 0);
  const totalCheck = Object.values(rosters).reduce((a, r) => a + r.filter((x) => x[1]).length, 0);
  const totalWait = TODAY.reduce((a, c) => a + c.wait.length, 0);
  const totalCap = TODAY.reduce((a, c) => a + ATYPES[c.type].cap, 0);
  const util = Math.round(totalAtt / totalCap * 100);

  function toggle(clsId, i) {
    setRosters((prev) => {
      const next = { ...prev, [clsId]: prev[clsId].map((r, idx) => idx === i ? [r[0], !r[1]] : r) };
      return next;
    });
  }
  const cls = openCls ? TODAY.find((c) => c.id === openCls) : null;

  return (
    <div>
      <PageTitle sub={aT(A.today_long, lang)}>{aT(A.overview, lang)}</PageTitle>

      {/* stats */}
      <div className="admin-statgrid" style={{ marginBottom: 22 }}>
        <Stat label={aT(A.classes_today, lang)} value={TODAY.length} />
        <Stat label={aT(A.attendees, lang)} value={totalAtt} sub={'/ ' + totalCap} />
        <Stat label={aT(A.checked_in, lang)} value={totalCheck} accent="var(--a-sage-deep)" />
        <Stat label={aT(A.waitlisted, lang)} value={totalWait} accent={totalWait ? '#9A7B45' : undefined} />
        <Stat label={aT(A.utilisation, lang)} value={util + '%'} />
      </div>

      {/* class timeline */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {TODAY.map((c) => {
          const ty = ATYPES[c.type];const roster = rosters[c.id];const booked = roster.length;
          const checked = roster.filter((x) => x[1]).length;const full = booked >= ty.cap;
          return (
            <Card key={c.id} onClick={() => setOpenCls(c.id)} pad={0} style={{ overflow: 'hidden' }}>
              <div className="admin-classrow">
                {/* time block */}
                <div className="admin-classtime">
                  <div style={{ fontFamily: "'Schibsted Grotesk', sans-serif", fontWeight: 700, color: 'var(--a-ink)', lineHeight: 1, fontSize: "15px" }}>{c.time}</div>
                  <div style={{ fontFamily: "'Hanken Grotesk', sans-serif", fontSize: 11.5, color: 'var(--a-muted)', marginTop: 3 }}>{endT(c.time, c.dur)}</div>
                </div>
                {/* main */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                    <Dot type={c.type} size={8} />
                    <span style={{ fontFamily: "'Schibsted Grotesk','IBM Plex Sans Thai',sans-serif", fontWeight: 600, fontSize: 16, color: 'var(--a-ink)' }}>{aT(ty.label, lang)}</span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: "'Hanken Grotesk', sans-serif", fontSize: 12.5, color: 'var(--a-ink-soft)' }}>
                      <Avatar id={c.instr} size={20} />{aT(AINSTR[c.instr].name, lang)}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ flex: 1, maxWidth: 180 }}><CapBar booked={booked} cap={ty.cap} /></div>
                    <span style={{ fontFamily: "'Hanken Grotesk', sans-serif", fontSize: 12, fontWeight: 600, color: full ? 'var(--a-muted)' : 'var(--a-sage-deep)' }}>{booked}/{ty.cap}</span>
                    {c.wait.length > 0 && <Badge tone="amber">+{c.wait.length} {aT(A.waitlist, lang)}</Badge>}
                  </div>
                </div>
                {/* attendee avatars + check status */}
                <div className="admin-classmeta">
                  <div style={{ display: 'flex' }}>
                    {roster.slice(0, 3).map((r, i) =>
                    <div key={i} style={{ marginLeft: i ? -8 : 0, border: '2px solid var(--a-surface-2)', borderRadius: 99, position: 'relative', opacity: r[1] ? 1 : 0.85 }}>
                        <Avatar id={r[0]} size={30} />
                        {r[1] && <span style={{ position: 'absolute', right: -2, bottom: -2, width: 13, height: 13, borderRadius: 99, background: 'var(--a-sage)', border: '2px solid var(--a-surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="check" size={8} stroke={3} style={{ color: '#fff' }} /></span>}
                      </div>
                    )}
                  </div>
                  <Badge tone={checked === booked && booked > 0 ? 'green' : 'neutral'}>{checked}/{booked} {aT(A.checked_in, lang)}</Badge>
                  <Icon name="chevR" size={18} style={{ color: 'var(--a-muted)' }} />
                </div>
              </div>
            </Card>);

        })}
      </div>

      {/* roster drawer */}
      <Drawer open={!!openCls} onClose={() => setOpenCls(null)}
      title={cls ? aT(ATYPES[cls.type].label, lang) + ' · ' + cls.time : ''}
      footer={cls && <Btn icon="check" onClick={() => setOpenCls(null)}>{lang === 'th' ? 'เสร็จสิ้น' : 'Done'}</Btn>}>
        {cls &&
        <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18, padding: '12px 14px', borderRadius: 13, background: 'var(--a-cream-2)' }}>
              <Avatar id={cls.instr} size={36} />
              <div>
                <div style={{ fontFamily: "'Hanken Grotesk', sans-serif", fontSize: 13.5, fontWeight: 600, color: 'var(--a-ink)' }}>{aT(AINSTR[cls.instr].name, lang)}</div>
                <div style={{ fontFamily: "'Hanken Grotesk', sans-serif", fontSize: 12, color: 'var(--a-muted)' }}>{cls.time}–{endT(cls.time, cls.dur)} · {cls.dur} {lang === 'th' ? 'นาที' : 'min'}</div>
              </div>
            </div>
            <div style={{ fontFamily: "'Hanken Grotesk', sans-serif", fontSize: 11.5, fontWeight: 600, letterSpacing: 0.6, textTransform: 'uppercase', color: 'var(--a-muted)', marginBottom: 10 }}>{aT(A.roster, lang)} · {rosters[cls.id].length}/{ATYPES[cls.type].cap}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {rosters[cls.id].map((r, i) => {
              const m = mem(r[0]);
              return (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: 13, border: '1px solid var(--a-line)', background: r[1] ? 'rgba(140,154,126,0.08)' : 'var(--a-surface)' }}>
                    <Avatar id={r[0]} size={38} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                        <span style={{ fontFamily: "'Hanken Grotesk', sans-serif", fontSize: 14, fontWeight: 600, color: 'var(--a-ink)' }}>{aT(m.name, lang)}</span>
                        {m.member && <Badge tone="neutral">{aT(A.member, lang)}</Badge>}
                      </div>
                      <div style={{ fontFamily: "'Hanken Grotesk', sans-serif", fontSize: 12, color: 'var(--a-muted)', marginTop: 1 }}>{m.phone} · {aT(A.house, lang)} {m.house}</div>
                    </div>
                    <button onClick={() => toggle(cls.id, i)} style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6, height: 36, padding: '0 14px', borderRadius: 10, cursor: 'pointer',
                    border: r[1] ? 'none' : '1px solid var(--a-line-strong)', background: r[1] ? 'var(--a-sage)' : 'transparent', color: r[1] ? '#fff' : 'var(--a-ink)',
                    fontFamily: "'Hanken Grotesk', sans-serif", fontSize: 13, fontWeight: 600
                  }}>
                      <Icon name="check" size={15} stroke={2.4} />{r[1] ? aT(A.checked, lang) : aT(A.check_in, lang)}
                    </button>
                  </div>);

            })}
              {cls.wait.length > 0 &&
            <div style={{ marginTop: 10 }}>
                  <div style={{ fontFamily: "'Hanken Grotesk', sans-serif", fontSize: 11.5, fontWeight: 600, letterSpacing: 0.6, textTransform: 'uppercase', color: '#9A7B45', marginBottom: 10 }}>{aT(A.waitlist, lang)} · {cls.wait.length}</div>
                  {cls.wait.map((w, i) => {
                const m = mem(w[0]);
                return (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: 13, border: '1px dashed var(--a-line-strong)', marginBottom: 8 }}>
                        <span style={{ fontFamily: "'Schibsted Grotesk', sans-serif", fontWeight: 700, fontSize: 14, color: 'var(--a-muted)', width: 18 }}>{i + 1}</span>
                        <Avatar id={w[0]} size={34} />
                        <div style={{ flex: 1 }}>
                          <div style={{ fontFamily: "'Hanken Grotesk', sans-serif", fontSize: 13.5, fontWeight: 600, color: 'var(--a-ink)' }}>{aT(m.name, lang)}</div>
                          <div style={{ fontFamily: "'Hanken Grotesk', sans-serif", fontSize: 12, color: 'var(--a-muted)' }}>{m.phone}</div>
                        </div>
                        <Btn kind="ghost" size="sm" icon="bell">{aT(A.notify, lang)}</Btn>
                      </div>);

              })}
                </div>
            }
            </div>
          </div>
        }
      </Drawer>
    </div>);

}

Object.assign(window, { TodayScreen, endT });