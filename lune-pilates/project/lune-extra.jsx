// lune-extra.jsx — Bookings + Profile tab screens
function BookingsScreen() {
  const { t, tt, lang, openClass, go, credits } = useLune();
  const [tab, setTab] = useState('upcoming');
  const [sheet, setSheet] = useState(null); // {kind:'reschedule'|'cancel'|'resched_done'|'cancel_done', booking, newSlot, late}
  const next = USER.next;
  const nextType = TYPES[next.type];
  const upcomingBooking = { ...next, id: next.sessionId, booked: 1, instr: null };

  // hours until the booked class (now = Jun 2, 09:41; class = today 18:00)
  const hoursUntil = (parseInt(next.time.slice(0, 2), 10) * 60 + parseInt(next.time.slice(3), 10) - (9 * 60 + 41)) / 60;
  const within5 = hoursUntil <= 5;

  return (
    <div style={{ padding: '6px 22px 28px' }}>
      <h1 style={{ margin: '4px 0 14px', fontFamily: 'var(--font-head)', fontWeight: 500, fontSize: 30, color: 'var(--ink)', letterSpacing: 0.2 }}>{t('nav_bookings')}</h1>

      {/* segmented */}
      <div style={{ display: 'flex', background: 'var(--cream-2)', borderRadius: 99, padding: 4, marginBottom: 20 }}>
        {[['upcoming', lang === 'th' ? 'กำลังจะถึง' : 'Upcoming'], ['past', lang === 'th' ? 'ที่ผ่านมา' : 'Past']].map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} style={{
            flex: 1, padding: '10px', borderRadius: 99, border: 'none', cursor: 'pointer',
            fontFamily: 'var(--font-body)', fontSize: 13.5, fontWeight: 600,
            background: tab === k ? 'var(--surface-2)' : 'transparent', color: tab === k ? 'var(--ink)' : 'var(--muted)',
            boxShadow: tab === k ? 'var(--shadow-sm)' : 'none', transition: 'all .2s',
          }}>{label}</button>
        ))}
      </div>

      {tab === 'upcoming' ? (
        <div>
          {/* policy banner */}
          <div style={{ display: 'flex', gap: 11, background: 'var(--cream-2)', borderRadius: 'var(--radius-sm)', padding: '13px 15px', marginBottom: 16 }}>
            <div style={{ color: 'var(--taupe-deep)', flexShrink: 0, marginTop: 1 }}><Icon name="info" size={18} /></div>
            <p style={{ margin: 0, fontFamily: 'var(--font-body)', fontSize: 12.5, lineHeight: 1.5, color: 'var(--ink-soft)' }}>{t('policy_body')}</p>
          </div>
          <BookingCard s={upcomingBooking} type={next.type} dateStr={lang === 'th' ? 'วันนี้ · 1 มิ.ย.' : 'Today · 1 Jun'} canCancel
            onReschedule={() => setSheet({ kind: 'reschedule', booking: upcomingBooking })}
            onCancel={() => setSheet({ kind: 'cancel', booking: upcomingBooking, late: within5, hoursUntil })} />
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {[['group', lang === 'th' ? 'พฤ. 29 พ.ค.' : 'Thu · 29 May', '07:00'], ['private', lang === 'th' ? 'จ. 26 พ.ค.' : 'Mon · 26 May', '10:00'], ['group', lang === 'th' ? 'ศ. 23 พ.ค.' : 'Fri · 23 May', '18:30']].map(([ty, ds, tm], i) => (
            <BookingCard key={i} s={{ id: 'past', time: tm, dur: 50, type: ty, instr: ty === 'private' ? 'mai' : null }} type={ty} dateStr={ds} past />
          ))}
        </div>
      )}

      {/* reschedule sheet */}
      <Sheet open={sheet && sheet.kind === 'reschedule'} onClose={() => setSheet(null)} maxH="86%">
        {sheet && sheet.kind === 'reschedule' && (
          <RescheduleContent booking={sheet.booking}
            onConfirm={() => setSheet({ kind: 'resched_done', booking: sheet.booking })}
            onCancel={() => setSheet(null)} />
        )}
      </Sheet>
      <Sheet open={sheet && sheet.kind === 'resched_done'} onClose={() => setSheet(null)} maxH="62%">
        {sheet && sheet.kind === 'resched_done' && (
          <ActionDone tone="sage" icon="calPlus" title={t('resched_done')} sub={t('resched_done_sub')} onDone={() => setSheet(null)} />
        )}
      </Sheet>

      {/* cancel sheet */}
      <Sheet open={sheet && sheet.kind === 'cancel'} onClose={() => setSheet(null)} maxH="72%">
        {sheet && sheet.kind === 'cancel' && (
          <CancelContent booking={sheet.booking} type={next.type} late={sheet.late} hoursUntil={sheet.hoursUntil}
            onConfirm={() => setSheet({ kind: 'cancel_done', late: sheet.late })}
            onKeep={() => setSheet(null)} />
        )}
      </Sheet>
      <Sheet open={sheet && sheet.kind === 'cancel_done'} onClose={() => setSheet(null)} maxH="60%">
        {sheet && sheet.kind === 'cancel_done' && (
          <ActionDone tone={sheet.late ? 'rose' : 'sage'} icon="check" title={t('cancelled_title')} sub={sheet.late ? t('cancelled_late_sub') : t('cancelled_free_sub')} onDone={() => setSheet(null)} />
        )}
      </Sheet>
    </div>
  );
}

function BookingCard({ s, type, dateStr, canCancel, past, onReschedule, onCancel }) {
  const { t, tt, lang } = useLune();
  const ty = TYPES[type];
  const instr = s.instr ? INSTRUCTORS[s.instr] : null;
  return (
    <div style={{ background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 'var(--radius)', padding: '16px 18px', boxShadow: 'var(--shadow-sm)', opacity: past ? 0.78 : 1 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 5 }}>
            <TypeDot type={type} size={7} />
            <span style={{ fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 600, letterSpacing: 0.5, textTransform: 'uppercase', color: 'var(--muted)' }}>{tt(ty.short)}</span>
          </div>
          <div style={{ fontFamily: 'var(--font-head)', fontWeight: 600, fontSize: 21, color: 'var(--ink)', lineHeight: 1.1 }}>{tt(ty.label)}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 7, fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--ink-soft)' }}>
            <Icon name="clock" size={14} /><span>{dateStr} · {s.time}–{endTime(s.time, s.dur)}</span>
          </div>
          {instr && <div style={{ fontFamily: 'var(--font-body)', fontSize: 12.5, color: 'var(--muted)', marginTop: 4 }}>{t('with_kru')} {tt(instr.name)}</div>}
        </div>
        {past
          ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--sage-deep)', fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 600 }}><Icon name="check" size={14} stroke={2} /></span>
          : <div style={{ width: 50, height: 50, borderRadius: 14, backgroundImage: `url(${(window.__resources&&window.__resources.studioEquip)||'assets/studio-equipment.jpg'})`, backgroundSize: 'cover', backgroundPosition: 'center' }} />}
      </div>
      {canCancel && (
        <div style={{ display: 'flex', gap: 10, marginTop: 15, paddingTop: 15, borderTop: '1px solid var(--line)' }}>
          <button onClick={onReschedule} style={smallBtn}>{t('reschedule')}</button>
          <button onClick={onCancel} style={{ ...smallBtn, color: 'var(--rose)', borderColor: 'rgba(196,154,134,0.4)' }}>{t('cancel')}</button>
        </div>
      )}
    </div>
  );
}

// ───────── reschedule sheet ─────────
function RescheduleContent({ booking, onConfirm, onCancel }) {
  const { t, tt, lang } = useLune();
  const ty = TYPES[booking.type];
  // alternative open slots of same type this week
  const alts = SESSIONS.filter((x) => x.type === booking.type && !isFull(x)).slice(0, 5);
  const [pick, setPick] = useState(alts.length ? alts[0].id : null);
  return (
    <div>
      <h2 style={sheetTitle}>{t('resched_title')}</h2>
      {/* current */}
      <div style={{ marginBottom: 16 }}>
        <Eyebrow style={{ marginBottom: 8 }}>{t('current_time')}</Eyebrow>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--cream-2)', borderRadius: 'var(--radius-sm)', padding: '13px 15px' }}>
          <Icon name="clock" size={17} style={{ color: 'var(--taupe-deep)' }} />
          <span style={{ fontFamily: 'var(--font-body)', fontSize: 13.5, fontWeight: 600, color: 'var(--ink)' }}>
            {tt(ty.label)} · {lang === 'th' ? 'วันนี้' : 'Today'} {booking.time}
          </span>
        </div>
      </div>
      <Eyebrow style={{ marginBottom: 10 }}>{t('resched_pick')}</Eyebrow>
      {alts.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '24px', fontFamily: 'var(--font-body)', fontSize: 14, color: 'var(--muted)' }}>{t('no_other_times')}</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
          {alts.map((x) => {
            const wd = WEEK[x.day - 1]; const on = pick === x.id; const left = spotsLeft(x);
            return (
              <button key={x.id} onClick={() => setPick(x.id)} style={{
                display: 'flex', alignItems: 'center', gap: 13, textAlign: 'left', cursor: 'pointer', width: '100%',
                padding: '13px 15px', borderRadius: 'var(--radius-sm)',
                border: '1.5px solid ' + (on ? 'var(--taupe)' : 'var(--line)'), background: on ? 'var(--surface-2)' : 'transparent', transition: 'all .2s',
              }}>
                <div style={{ width: 22, height: 22, borderRadius: 99, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1.5px solid ' + (on ? 'var(--taupe)' : 'var(--line-strong)'), background: on ? 'var(--taupe)' : 'transparent', color: '#fff' }}>{on && <Icon name="check" size={13} stroke={2.6} />}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: 'var(--font-head)', fontWeight: 600, fontSize: 17, color: 'var(--ink)' }}>{tt(wd.dow)} {wd.date} {lang === 'th' ? 'มิ.ย.' : 'Jun'} · {x.time}</div>
                  <div style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{left} {left === 1 ? t('spot_left') : t('spots_left')}{x.instr ? ` · ${tt(INSTRUCTORS[x.instr].name)}` : ''}</div>
                </div>
              </button>
            );
          })}
        </div>
      )}
      <div style={{ marginTop: 18 }}><PrimaryButton onClick={onConfirm} disabled={!pick} icon="check">{t('confirm_resched')}</PrimaryButton></div>
      <button onClick={onCancel} style={textBtn}>{t('keep_time')}</button>
    </div>
  );
}

// ───────── cancel sheet ─────────
function CancelContent({ booking, type, late, hoursUntil, onConfirm, onKeep }) {
  const { t, tt, lang } = useLune();
  const ty = TYPES[type];
  const hrs = Math.max(0, Math.floor(hoursUntil));
  const mins = Math.round((hoursUntil - hrs) * 60);
  const untilStr = lang === 'th' ? `${hrs} ชม. ${mins} นาที` : `${hrs}h ${mins}m`;
  return (
    <div>
      <h2 style={sheetTitle}>{t('cancel_title')}</h2>
      <SummaryCard s={{ ...booking, dur: booking.dur }} ty={ty} dateStr={lang === 'th' ? 'วันนี้ · 1 มิ.ย.' : 'Today · 1 Jun'} />
      {/* countdown */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 12, padding: '11px 15px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--line)' }}>
        <span style={{ fontFamily: 'var(--font-body)', fontSize: 12.5, color: 'var(--ink-soft)' }}>{untilStr} {t('time_until_class')}</span>
        <Icon name="clock" size={16} style={{ color: 'var(--muted)' }} />
      </div>
      {/* policy verdict */}
      <div style={{ display: 'flex', gap: 12, marginTop: 12, borderRadius: 'var(--radius-sm)', padding: '15px 16px', background: late ? 'rgba(196,154,134,0.12)' : 'rgba(140,154,126,0.13)', border: '1px solid ' + (late ? 'rgba(196,154,134,0.32)' : 'rgba(140,154,126,0.32)') }}>
        <div style={{ flexShrink: 0, marginTop: 1, color: late ? 'var(--rose)' : 'var(--sage-deep)' }}><Icon name={late ? 'info' : 'checkCircle'} size={20} /></div>
        <div>
          <div style={{ fontFamily: 'var(--font-body)', fontSize: 13.5, fontWeight: 700, color: late ? '#A56A52' : 'var(--sage-deep)', marginBottom: 3 }}>{late ? t('late_cancel') : t('free_cancel')}</div>
          <div style={{ fontFamily: 'var(--font-body)', fontSize: 12.5, lineHeight: 1.5, color: 'var(--ink-soft)' }}>{late ? t('late_cancel_sub') : t('free_cancel_sub')}</div>
        </div>
      </div>
      <div style={{ marginTop: 18 }}>
        <button onClick={onConfirm} style={{ width: '100%', height: 56, borderRadius: 'var(--radius-sm)', cursor: 'pointer', border: 'none', background: late ? 'var(--rose)' : 'var(--ink)', color: '#fff', fontFamily: 'var(--font-body)', fontSize: 16, fontWeight: 600, letterSpacing: 0.2, boxShadow: '0 6px 20px rgba(46,40,32,0.16)' }}>{t('cancel_class')}</button>
      </div>
      <button onClick={onKeep} style={{ ...textBtn, color: 'var(--ink)', fontWeight: 700 }}>{t('keep_booking')}</button>
    </div>
  );
}

// ───────── shared action-done ─────────
function ActionDone({ tone, icon, title, sub, onDone }) {
  const { t } = useLune();
  const bg = tone === 'rose' ? 'var(--rose)' : 'var(--sage)';
  return (
    <div style={{ textAlign: 'center', paddingTop: 8 }}>
      <div style={{ width: 76, height: 76, borderRadius: 99, margin: '4px auto 18px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: bg, color: '#fff', boxShadow: `0 10px 30px ${tone === 'rose' ? 'rgba(196,154,134,0.4)' : 'rgba(140,154,126,0.4)'}` }}>
        <Icon name={icon} size={34} stroke={2} />
      </div>
      <h2 style={{ margin: '0 0 8px', fontFamily: 'var(--font-head)', fontWeight: 600, fontSize: 28, color: 'var(--ink)' }}>{title}</h2>
      <p style={{ margin: '0 auto 22px', maxWidth: 290, fontFamily: 'var(--font-body)', fontSize: 14, lineHeight: 1.55, color: 'var(--ink-soft)' }}>{sub}</p>
      <PrimaryButton onClick={onDone}>{t('done')}</PrimaryButton>
    </div>
  );
}

const smallBtn = {
  flex: 1, padding: '11px', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
  border: '1px solid var(--line-strong)', background: 'transparent',
  fontFamily: 'var(--font-body)', fontSize: 13.5, fontWeight: 600, color: 'var(--ink)',
};

function ProfileScreen() {
  const { t, tt, lang, credits, go } = useLune();
  const history = [
    ['p10', lang === 'th' ? '18 พ.ค. 2569' : '18 May 2026', 5500],
    ['p5', lang === 'th' ? '2 พ.ค. 2569' : '2 May 2026', 2950],
  ];
  return (
    <div style={{ padding: '6px 22px 28px' }}>
      <h1 style={{ margin: '4px 0 18px', fontFamily: 'var(--font-head)', fontWeight: 500, fontSize: 30, color: 'var(--ink)', letterSpacing: 0.2 }}>{t('nav_profile')}</h1>

      {/* identity */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 15, marginBottom: 22 }}>
        <div style={{ width: 64, height: 64, borderRadius: 99, background: 'var(--taupe)', color: 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-head)', fontWeight: 600, fontSize: 28 }}>{tt(USER.name).slice(0, 1)}</div>
        <div>
          <div style={{ fontFamily: 'var(--font-head)', fontWeight: 600, fontSize: 24, color: 'var(--ink)' }}>{tt(USER.name)}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 9px', borderRadius: 99, background: 'var(--cream-2)', color: 'var(--taupe-deep)', fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 600 }}><Sparkle size={10} color="var(--taupe)" />{t('member')}</span>
            <span style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--muted)' }}>{lang === 'th' ? 'บ้านเลขที่' : 'House'} {USER.house}</span>
          </div>
        </div>
      </div>

      {/* balance */}
      <div onClick={() => go('credits')} style={{ cursor: 'pointer', background: 'linear-gradient(150deg, var(--surface-2), var(--surface))', border: '1px solid var(--line)', borderRadius: 'var(--radius)', padding: '20px', boxShadow: 'var(--shadow-md)', marginBottom: 20, position: 'relative', overflow: 'hidden' }}>
        <Sparkle size={100} color="rgba(140,122,99,0.05)" style={{ position: 'absolute', top: -22, right: -18 }} />
        <Eyebrow>{t('credits_remaining')}</Eyebrow>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 7, margin: '4px 0 10px' }}>
          <span style={{ fontFamily: 'var(--font-head)', fontWeight: 600, fontSize: 48, lineHeight: 1, color: 'var(--ink)' }}>{credits}</span>
          <span style={{ fontFamily: 'var(--font-body)', fontWeight: 500, fontSize: 16, color: 'var(--taupe)' }}>{t('hours')}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 12, borderTop: '1px solid var(--line)' }}>
          <span style={{ fontFamily: 'var(--font-body)', fontSize: 12.5, color: 'var(--ink-soft)' }}>{t('valid_until')} <strong style={{ color: 'var(--ink)' }}>{tt(USER.validUntil)}</strong></span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 600, color: 'var(--taupe-deep)' }}>{t('buy_credits')}<Icon name="arrowR" size={15} /></span>
        </div>
      </div>

      {/* package history */}
      <Eyebrow style={{ margin: '0 2px 12px' }}>{lang === 'th' ? 'ประวัติแพ็กเกจ' : 'Package history'}</Eyebrow>
      <div style={{ borderRadius: 'var(--radius)', border: '1px solid var(--line)', overflow: 'hidden', background: 'var(--surface-2)' }}>
        {history.map(([id, date, price], i) => {
          const p = PACKAGES.find((x) => x.id === id);
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '15px 18px', borderBottom: i < history.length - 1 ? '1px solid var(--line)' : 'none' }}>
              <div>
                <div style={{ fontFamily: 'var(--font-head)', fontWeight: 600, fontSize: 18, color: 'var(--ink)' }}>{p.hours} {t('hours')}</div>
                <div style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{date}</div>
              </div>
              <span style={{ fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 600, color: 'var(--ink-soft)' }}>{thb(price)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

Object.assign(window, { BookingsScreen, BookingCard, ProfileScreen, smallBtn, RescheduleContent, CancelContent, ActionDone });
