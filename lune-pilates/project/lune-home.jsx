// lune-home.jsx — Home screen content
function endTime(time, dur) {
  let [h, m] = time.split(':').map(Number);
  m += dur; h += Math.floor(m / 60); m = m % 60;
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}
// minutes from "now" (09:41) to a HH:MM today
function minsUntil(time, now = '09:41') {
  const [nh, nm] = now.split(':').map(Number);
  const [th2, tm] = time.split(':').map(Number);
  return (th2 * 60 + tm) - (nh * 60 + nm);
}
function fmtUntil(mins, lang) {
  const h = Math.floor(mins / 60), m = mins % 60;
  if (lang === 'th') return (h ? h + ' ชม. ' : '') + (m ? m + ' นาที' : '').trim();
  return (h ? h + 'h ' : '') + (m ? m + 'm' : '').trim();
}

function HomeScreen() {
  const { t, tt, lang, go, credits, openClass } = useLune();
  const next = USER.next;
  const nextType = TYPES[next.type];
  const until = minsUntil(next.time);
  const dateLong = lang === 'th' ? 'วันจันทร์ที่ 1 มิถุนายน 2569' : 'Monday, 1 June 2026';

  // upcoming this-week sessions (not full, after today subset)
  const upcoming = SESSIONS.filter((s) => !isFull(s) && (s.day >= 1)).slice(0, 6);

  return (
    <div style={{ padding: '6px 22px 28px' }}>
      {/* greeting */}
      <div style={{ marginTop: 6, marginBottom: 22, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14 }}>
        <div style={{ minWidth: 0 }}>
          <Eyebrow>{dateLong}</Eyebrow>
          <h1 style={{
            margin: '8px 0 0', fontFamily: 'var(--font-head)', fontWeight: 500,
            fontSize: 36, lineHeight: 1.08, color: 'var(--ink)', letterSpacing: 0.2,
          }}>
            {t('greet_morning')}<br />
            <span style={{ color: 'var(--taupe-deep)' }}>{tt(USER.name)}</span>
          </h1>
        </div>
        <div style={{ flexShrink: 0, position: 'relative' }}>
          <image-slot id="line-avatar" shape="circle" placeholder="LINE photo"
            src="assets/studio-equipment.jpg"
            style={{ display: 'block', width: '60px', height: '60px', boxShadow: '0 4px 14px rgba(72,58,40,0.12)', border: '2px solid var(--surface-2)', borderRadius: '50%' }}></image-slot>
          <span style={{ position: 'absolute', right: -2, bottom: -2, width: 22, height: 22, borderRadius: 99, background: '#06C755', border: '2.5px solid var(--cream)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-body)', fontSize: 9, fontWeight: 800, color: '#fff', letterSpacing: -0.5 }}>L</span>
        </div>
      </div>

      {/* credits hero card */}
      <div onClick={() => go('credits')} style={{
        position: 'relative', overflow: 'hidden', cursor: 'pointer',
        background: 'linear-gradient(150deg, var(--surface-2), var(--surface))',
        border: '1px solid var(--line)', borderRadius: 'var(--radius)',
        padding: '22px 22px 18px', boxShadow: 'var(--shadow-md)', marginBottom: 18,
      }}>
        <Sparkle size={120} color="rgba(140,122,99,0.05)" style={{ position: 'absolute', top: -26, right: -22 }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', position: 'relative' }}>
          <Eyebrow>{t('credits_remaining')}</Eyebrow>
          {USER.member && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 5, padding: '5px 11px 5px 9px', borderRadius: 99,
              background: 'var(--cream-2)', color: 'var(--taupe-deep)', fontFamily: 'var(--font-body)',
              fontSize: 11.5, fontWeight: 600, letterSpacing: 0.4,
            }}>
              <Sparkle size={11} color="var(--taupe)" />{t('member')}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, margin: '6px 0 2px' }}>
          <span style={{ fontFamily: 'var(--font-head)', fontWeight: 600, fontSize: 60, lineHeight: 1, color: 'var(--ink)' }}>{credits}</span>
          <span style={{ fontFamily: 'var(--font-body)', fontWeight: 500, fontSize: 18, color: 'var(--taupe)' }}>{t('hours')}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, paddingTop: 14, borderTop: '1px solid var(--line)' }}>
          <span style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--ink-soft)' }}>
            {t('valid_until')} <strong style={{ fontWeight: 600, color: 'var(--ink)' }}>{tt(USER.validUntil)}</strong>
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'var(--font-body)', fontSize: 13.5, fontWeight: 600, color: 'var(--taupe-deep)' }}>
            {t('buy_credits')}<Icon name="arrowR" size={16} />
          </span>
        </div>
      </div>

      {/* next class */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', margin: '24px 2px 12px' }}>
        <Eyebrow>{t('next_class')}</Eyebrow>
        <span style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--muted)' }}>
          {t('starts_in')} {fmtUntil(until, lang)}
        </span>
      </div>
      <div onClick={() => openClass(next.sessionId)} style={{
        display: 'flex', gap: 0, background: 'var(--surface-2)', border: '1px solid var(--line)',
        borderRadius: 'var(--radius)', overflow: 'hidden', cursor: 'pointer', boxShadow: 'var(--shadow-sm)',
      }}>
        <div style={{ width: 104, flexShrink: 0, backgroundImage: `url(${(window.__resources&&window.__resources.studioEquip)||'assets/studio-equipment.jpg'})`, backgroundSize: 'cover', backgroundPosition: 'center' }} />
        <div style={{ flex: 1, padding: '16px 16px 16px 17px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 6 }}>
            <TypeDot type={next.type} /><span style={{ fontFamily: 'var(--font-body)', fontSize: 11.5, fontWeight: 600, letterSpacing: 0.5, textTransform: 'uppercase', color: 'var(--muted)' }}>{tt(nextType.short)}</span>
          </div>
          <div style={{ fontFamily: 'var(--font-head)', fontWeight: 600, fontSize: 23, lineHeight: 1.1, color: 'var(--ink)', marginBottom: 9 }}>{tt(nextType.label)}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--ink-soft)', fontFamily: 'var(--font-body)', fontSize: 13.5 }}>
            <Icon name="clock" size={15} />
            <span><strong style={{ fontWeight: 600, color: 'var(--ink)' }}>{tt(next.date)}</strong> · {next.time}–{endTime(next.time, next.dur)}</span>
          </div>
        </div>
      </div>

      {/* primary CTA */}
      <div style={{ margin: '20px 0 8px' }}>
        <PrimaryButton onClick={() => go('schedule')} icon="arrowR">{t('book_a_class')}</PrimaryButton>
      </div>

      {/* this week */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', margin: '24px 2px 14px' }}>
        <Eyebrow>{t('this_week')}</Eyebrow>
        <span onClick={() => go('schedule')} style={{ cursor: 'pointer', fontFamily: 'var(--font-body)', fontSize: 12.5, fontWeight: 600, color: 'var(--taupe-deep)' }}>{t('see_all')}</span>
      </div>
      <div style={{ display: 'flex', gap: 12, overflowX: 'auto', margin: '0 -22px', padding: '0 22px 6px', scrollbarWidth: 'none' }}>
        {upcoming.map((s) => {
          const ty = TYPES[s.type]; const wd = WEEK[s.day - 1]; const left = spotsLeft(s);
          return (
            <div key={s.id} onClick={() => openClass(s.id)} style={{
              flexShrink: 0, width: 142, background: 'var(--surface-2)', border: '1px solid var(--line)',
              borderRadius: 'var(--radius-sm)', padding: '14px 14px 13px', cursor: 'pointer', boxShadow: 'var(--shadow-sm)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 600, color: 'var(--taupe-deep)', marginBottom: 10 }}>
                <span style={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>{tt(wd.dow)}</span>
                <span style={{ color: 'var(--muted)' }}>{wd.date} {lang === 'th' ? 'มิ.ย.' : 'Jun'}</span>
              </div>
              <div style={{ fontFamily: 'var(--font-head)', fontWeight: 600, fontSize: 18, lineHeight: 1.1, color: 'var(--ink)', marginBottom: 4 }}>{s.time}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 11 }}>
                <TypeDot type={s.type} size={7} /><span style={{ fontFamily: 'var(--font-body)', fontSize: 12.5, color: 'var(--ink-soft)' }}>{tt(ty.short)}</span>
              </div>
              <div style={{ fontFamily: 'var(--font-body)', fontSize: 11.5, fontWeight: 600, color: left <= 1 ? 'var(--rose)' : 'var(--sage-deep)' }}>
                {left} {left === 1 ? t('spot_left') : t('spots_left')}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

Object.assign(window, { HomeScreen, endTime, minsUntil, fmtUntil });
