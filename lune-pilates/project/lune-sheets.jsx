// lune-sheets.jsx — booking flow sheet contents
function SummaryCard({ s, ty, dateStr, instr }) {
  const { tt, t } = useLune();
  return (
    <div style={{ display: 'flex', gap: 14, background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)', padding: '14px 15px', boxShadow: 'var(--shadow-sm)' }}>
      <div style={{ width: 56, height: 56, borderRadius: 14, flexShrink: 0, backgroundImage: `url(${(window.__resources&&window.__resources.studioEquip)||'assets/studio-equipment.jpg'})`, backgroundSize: 'cover', backgroundPosition: 'center' }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
          <TypeDot type={s.type} size={7} />
          <span style={{ fontFamily: 'var(--font-body)', fontSize: 10.5, fontWeight: 600, letterSpacing: 0.5, textTransform: 'uppercase', color: 'var(--muted)' }}>{tt(ty.short)}</span>
        </div>
        <div style={{ fontFamily: 'var(--font-head)', fontWeight: 600, fontSize: 19, color: 'var(--ink)', lineHeight: 1.1 }}>{tt(ty.label)}</div>
        <div style={{ fontFamily: 'var(--font-body)', fontSize: 12.5, color: 'var(--ink-soft)', marginTop: 4 }}>
          {dateStr} · {s.time}–{endTime(s.time, s.dur)}{instr ? ` · ${tt(instr.name)}` : ''}
        </div>
      </div>
    </div>
  );
}

function ConfirmContent({ s, ty, instr, dateStr, cost, credits, onConfirm, onCancel }) {
  const { t } = useLune();
  const after = Math.round((credits - cost) * 10) / 10;
  return (
    <div>
      <h2 style={sheetTitle}>{t('confirm_booking')}</h2>
      <SummaryCard s={s} ty={ty} dateStr={dateStr} instr={instr} />
      <div style={{ marginTop: 16, borderRadius: 'var(--radius-sm)', border: '1px solid var(--line)', overflow: 'hidden' }}>
        <Line label={t('costs')} value={`${cost} ${cost === 1 ? t('hour') : t('hours')}`} />
        <Line label={t('remaining_after')} value={`${after} ${t('hours')}`} last />
      </div>
      <div style={{ marginTop: 14, display: 'flex', gap: 8, alignItems: 'flex-start', padding: '0 2px' }}>
        <div style={{ color: 'var(--muted)', flexShrink: 0, marginTop: 1 }}><Icon name="info" size={16} /></div>
        <p style={{ margin: 0, fontFamily: 'var(--font-body)', fontSize: 12, lineHeight: 1.5, color: 'var(--muted)' }}>{t('policy_body')}</p>
      </div>
      <div style={{ marginTop: 18 }}><PrimaryButton onClick={onConfirm} icon="check">{t('confirm')}</PrimaryButton></div>
      <button onClick={onCancel} style={textBtn}>{t('cancel')}</button>
    </div>
  );
}

function WaitlistContent({ s, ty, dateStr, onConfirm, onCancel }) {
  const { t } = useLune();
  return (
    <div>
      <h2 style={sheetTitle}>{t('join_waitlist')}</h2>
      <SummaryCard s={s} ty={ty} dateStr={dateStr} />
      <div style={{ marginTop: 14, display: 'flex', gap: 12, background: 'var(--cream-2)', borderRadius: 'var(--radius-sm)', padding: '15px 16px' }}>
        <div style={{ color: 'var(--taupe-deep)', flexShrink: 0, marginTop: 1 }}><Icon name="bell" size={20} /></div>
        <p style={{ margin: 0, fontFamily: 'var(--font-body)', fontSize: 13, lineHeight: 1.55, color: 'var(--ink-soft)' }}>{t('waitlist_sub')}</p>
      </div>
      <div style={{ marginTop: 18 }}><PrimaryButton onClick={onConfirm} icon="bell">{t('join_waitlist')}</PrimaryButton></div>
      <button onClick={onCancel} style={textBtn}>{t('cancel')}</button>
    </div>
  );
}

function SuccessContent({ title, sub, s, ty, dateStr, instr, showCal, waitlist, onDone }) {
  const { t, tt } = useLune();
  return (
    <div style={{ textAlign: 'center', paddingTop: 8 }}>
      <div style={{
        width: 76, height: 76, borderRadius: 99, margin: '4px auto 18px', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: waitlist ? 'var(--cream-2)' : 'var(--sage)', color: waitlist ? 'var(--taupe-deep)' : '#fff',
        boxShadow: waitlist ? 'none' : '0 10px 30px rgba(140,154,126,0.4)',
      }}>
        <Icon name={waitlist ? 'bell' : 'check'} size={36} stroke={2} />
      </div>
      <h2 style={{ margin: '0 0 8px', fontFamily: 'var(--font-head)', fontWeight: 600, fontSize: 30, color: 'var(--ink)' }}>{title}</h2>
      <p style={{ margin: '0 auto 20px', maxWidth: 290, fontFamily: 'var(--font-body)', fontSize: 14, lineHeight: 1.55, color: 'var(--ink-soft)' }}>{sub}</p>
      <div style={{ textAlign: 'left' }}><SummaryCard s={s} ty={ty} dateStr={dateStr} instr={instr} /></div>
      {showCal && (
        <button style={{ ...textBtn, marginTop: 16, color: 'var(--taupe-deep)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, width: '100%' }}>
          <Icon name="calPlus" size={18} />{t('add_calendar')}
        </button>
      )}
      <div style={{ marginTop: showCal ? 8 : 18 }}><PrimaryButton onClick={onDone}>{t('done')}</PrimaryButton></div>
    </div>
  );
}

function Line({ label, value, last }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '13px 16px',
      borderBottom: last ? 'none' : '1px solid var(--line)', background: 'var(--surface-2)',
    }}>
      <span style={{ fontFamily: 'var(--font-body)', fontSize: 13.5, color: 'var(--ink-soft)' }}>{label}</span>
      <span style={{ fontFamily: 'var(--font-body)', fontSize: 14.5, fontWeight: 600, color: 'var(--ink)' }}>{value}</span>
    </div>
  );
}

const sheetTitle = { margin: '6px 0 16px', fontFamily: 'var(--font-head)', fontWeight: 600, fontSize: 26, color: 'var(--ink)', letterSpacing: 0.2 };
const textBtn = { width: '100%', marginTop: 10, padding: '12px', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--font-body)', fontSize: 14.5, fontWeight: 600, color: 'var(--muted)' };

Object.assign(window, { SummaryCard, ConfirmContent, WaitlistContent, SuccessContent, Line, sheetTitle, textBtn });
