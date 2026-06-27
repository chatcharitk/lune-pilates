// admin-mobile-analytics.jsx — Business dashboard (mobile): sales, capacity, retention
function MAnalytics({ onBack }) {
  const { t, tt, lang } = useM();
  const L = (en, th) => (lang === 'th' ? th : en);
  const [period, setPeriod] = React.useState('mtd');

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--a-cream)' }}>
      <MHeader title={t('biz_overview')} onBack={onBack} />
      <div style={{ flex: 1, overflowY: 'auto', padding: '6px 18px 30px' }}>

        {/* period toggle */}
        <div style={{ display: 'flex', background: 'var(--a-cream-2)', borderRadius: 12, padding: 3, marginBottom: 16 }}>
          {[['mtd', L('Month to date', 'เดือนนี้')], ['today', L('Today', 'วันนี้')]].map(([k, lb]) => (
            <button key={k} onClick={() => setPeriod(k)} style={{ flex: 1, padding: '9px 4px', borderRadius: 9, border: 'none', cursor: 'pointer', fontFamily: "'Hanken Grotesk','IBM Plex Sans Thai',sans-serif", fontSize: 13, fontWeight: 600, background: period === k ? 'var(--a-surface-2)' : 'transparent', color: period === k ? 'var(--a-ink)' : 'var(--a-muted)', boxShadow: period === k ? 'var(--a-shadow)' : 'none' }}>{lb}</button>
          ))}
        </div>

        {/* ── 01 SALES ── */}
        <ASecLabel n="01" title={L('Sales & revenue', 'ยอดขาย & รายได้')} />

        {/* headline sales card */}
        <div style={{ background: 'var(--a-ink)', borderRadius: 18, padding: '20px 20px', marginBottom: 12, position: 'relative', overflow: 'hidden' }}>
          <div style={{ display: 'flex', gap: 20 }}>
            <div style={{ flex: 1 }}>
              <div style={aEyebrowDark}>{period === 'mtd' ? L('Month to date', 'เดือนนี้') : L('Today', 'วันนี้')}</div>
              <div style={{ fontFamily: "'Schibsted Grotesk',sans-serif", fontWeight: 700, fontSize: 34, letterSpacing: '-1px', color: '#F6EFE6', lineHeight: 1.05, marginTop: 5 }}>{period === 'mtd' ? '฿341,800' : '฿18,400'}</div>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 8, padding: '3px 9px', borderRadius: 99, background: 'rgba(140,154,126,0.22)', color: '#B9C7A8', fontFamily: "'Hanken Grotesk','IBM Plex Sans Thai',sans-serif", fontSize: 12, fontWeight: 700 }}>
                <Icon name="chevD" size={11} style={{ transform: 'rotate(180deg)' }} />{period === 'mtd' ? L('+10.4% vs last month', '+10.4% จากเดือนก่อน') : L('+23% vs yesterday', '+23% จากเมื่อวาน')}
              </div>
            </div>
            <div style={{ width: 1, background: 'rgba(243,236,226,0.14)' }} />
            <div style={{ flex: 1 }}>
              <div style={aEyebrowDark}>{period === 'mtd' ? L('Today', 'วันนี้') : L('This month', 'เดือนนี้')}</div>
              <div style={{ fontFamily: "'Schibsted Grotesk',sans-serif", fontWeight: 700, fontSize: 26, letterSpacing: '-0.5px', color: 'rgba(243,236,226,0.86)', lineHeight: 1.05, marginTop: 5 }}>{period === 'mtd' ? '฿18,400' : '฿341,800'}</div>
              <div style={{ fontFamily: "'Hanken Grotesk','IBM Plex Sans Thai',sans-serif", fontSize: 11.5, color: 'rgba(243,236,226,0.5)', marginTop: 9 }}>{L('612 h sold · 38% unredeemed', 'ขาย 612 ชม. · ค้าง 38%')}</div>
            </div>
          </div>
          {/* sparkline */}
          <ASpark />
        </div>

        {/* revenue mix */}
        <div style={aCard}>
          <div style={aEyebrow}>{L('Revenue mix · MTD', 'สัดส่วนรายได้ · เดือนนี้')}</div>
          <div style={{ display: 'flex', height: 12, borderRadius: 99, overflow: 'hidden', margin: '12px 0 14px' }}>
            <span style={{ width: '58%', background: 'var(--a-taupe)' }} />
            <span style={{ width: '33%', background: 'var(--a-sage)' }} />
            <span style={{ width: '9%', background: '#6E84A3' }} />
          </div>
          {[['Group', 'กลุ่ม', 'var(--a-taupe)', '58%', '฿198,000'], ['Privates', 'ส่วนตัว', 'var(--a-sage)', '33%', '฿112,800'], ['Rentals', 'เช่า', '#6E84A3', '9%', '฿31,000']].map((r, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '7px 0', borderTop: i ? '1px solid var(--a-line)' : 'none' }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: r[2], flexShrink: 0 }} />
              <span style={{ flex: 1, fontFamily: "'Hanken Grotesk','IBM Plex Sans Thai',sans-serif", fontSize: 13.5, fontWeight: 600, color: 'var(--a-ink-soft)' }}>{L(r[0], r[1])}</span>
              <span style={{ fontFamily: "'Hanken Grotesk',sans-serif", fontSize: 12, color: 'var(--a-muted)' }}>{r[4]}</span>
              <span style={{ fontFamily: "'Schibsted Grotesk',sans-serif", fontWeight: 700, fontSize: 14, color: 'var(--a-ink)', width: 38, textAlign: 'right' }}>{r[3]}</span>
            </div>
          ))}
        </div>

        {/* liability + trial */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 4 }}>
          <div style={aCard}>
            <div style={aEyebrow}>{L('Package liability', 'เครดิตคงค้าง')}</div>
            <div style={{ fontFamily: "'Schibsted Grotesk',sans-serif", fontWeight: 700, fontSize: 23, letterSpacing: '-0.5px', color: 'var(--a-taupe-deep)', marginTop: 8 }}>฿284,500</div>
            <div style={{ fontFamily: "'Hanken Grotesk','IBM Plex Sans Thai',sans-serif", fontSize: 11.5, color: 'var(--a-muted)', marginTop: 4 }}>{L('612 h unredeemed', 'ยังไม่ใช้ 612 ชม.')}</div>
          </div>
          <div style={aCard}>
            <div style={aEyebrow}>{L('Trial conversion', 'อัตราแปลงทดลอง')}</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 8 }}>
              <span style={{ fontFamily: "'Schibsted Grotesk',sans-serif", fontWeight: 700, fontSize: 23, color: 'var(--a-sage-deep)' }}>64%</span>
            </div>
            <div style={{ height: 7, borderRadius: 99, background: 'var(--a-cream-2)', overflow: 'hidden', margin: '8px 0 5px' }}><span style={{ display: 'block', height: '100%', width: '64%', background: 'var(--a-sage)' }} /></div>
            <div style={{ fontFamily: "'Hanken Grotesk','IBM Plex Sans Thai',sans-serif", fontSize: 11.5, color: 'var(--a-muted)' }}>{L('32 of 50 trials', '32 จาก 50 ราย')}</div>
          </div>
        </div>

        {/* revenue per instructor */}
        <div style={{ ...aCard, marginTop: 12 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
            <div style={aEyebrow}>{L('Revenue per instructor · MTD', 'รายได้ต่อผู้สอน · เดือนนี้')}</div>
            <span style={{ fontFamily: "'Hanken Grotesk','IBM Plex Sans Thai',sans-serif", fontSize: 11, color: 'var(--a-muted)' }}>{L('฿ · hrs taught', '฿ · ชม.สอน')}</span>
          </div>
          <div style={{ marginTop: 13 }}>
            {[['mai', 128400, 96, 'var(--a-taupe)'], ['ploy', 96200, 78, 'var(--a-sage)'], ['nina', 71600, 61, '#C0A079']].map((r, i) => {
              const maxRev = 128400;
              return (
                <div key={r[0]} style={{ display: 'flex', alignItems: 'center', gap: 11, marginTop: i ? 13 : 0 }}>
                  <Avatar id={r[0]} size={34} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 5 }}>
                      <span style={{ fontFamily: "'Hanken Grotesk','IBM Plex Sans Thai',sans-serif", fontSize: 13, fontWeight: 600, color: 'var(--a-ink)' }}>{tt(AINSTR[r[0]].name)}</span>
                      <span style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                        <span style={{ fontFamily: "'Schibsted Grotesk',sans-serif", fontWeight: 700, fontSize: 13.5, color: 'var(--a-ink)' }}>฿{(r[1] / 1000).toFixed(1)}k</span>
                        <span style={{ fontFamily: "'Hanken Grotesk','IBM Plex Sans Thai',sans-serif", fontSize: 10.5, color: 'var(--a-muted)' }}>{r[2]} {L('h', 'ชม.')}</span>
                      </span>
                    </div>
                    <div style={{ height: 7, borderRadius: 99, background: 'var(--a-cream-2)', overflow: 'hidden' }}><span style={{ display: 'block', height: '100%', width: (r[1] / maxRev) * 100 + '%', background: r[3] }} /></div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── 02 CAPACITY ── */}
        <ASecLabel n="02" title={L('Capacity & operations', 'ความจุ & การดำเนินงาน')} top />

        <div style={aCard}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontFamily: "'Schibsted Grotesk','IBM Plex Sans Thai',sans-serif", fontWeight: 600, fontSize: 15.5, color: 'var(--a-ink)' }}>{L('Class fill rate', 'อัตราการเต็มคลาส')}</div>
              <div style={{ fontFamily: "'Hanken Grotesk','IBM Plex Sans Thai',sans-serif", fontSize: 11.5, color: 'var(--a-muted)', marginTop: 1 }}>{L('Avg group · 30 days', 'เฉลี่ยกลุ่ม · 30 วัน')}</div>
            </div>
            <span style={{ fontFamily: "'Schibsted Grotesk',sans-serif", fontWeight: 700, fontSize: 30, letterSpacing: '-1px', color: 'var(--a-ink)' }}>78%</span>
          </div>
          <div style={{ marginTop: 12 }}>
            {[['Group', 'กลุ่ม', 82, 'var(--a-taupe)'], ['Private 1:1', 'ส่วนตัว 1:1', 71, 'var(--a-sage)'], ['Duo', 'ดูโอ', 68, '#C0A079'], ['Trio', 'ทรีโอ', 60, '#6E84A3']].map((r, i) => (
              <div key={i} style={{ marginTop: i ? 11 : 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5, fontFamily: "'Hanken Grotesk','IBM Plex Sans Thai',sans-serif", fontSize: 12.5 }}>
                  <span style={{ color: 'var(--a-ink-soft)', fontWeight: 600 }}>{L(r[0], r[1])}</span>
                  <span style={{ fontFamily: "'Schibsted Grotesk',sans-serif", fontWeight: 700, color: 'var(--a-ink)' }}>{r[2]}%</span>
                </div>
                <div style={{ height: 7, borderRadius: 99, background: 'var(--a-cream-2)', overflow: 'hidden' }}><span style={{ display: 'block', height: '100%', width: r[2] + '%', background: r[3] }} /></div>
              </div>
            ))}
          </div>
        </div>

        {/* alerts */}
        <div style={{ ...aCard, marginTop: 12 }}>
          <div style={{ fontFamily: "'Schibsted Grotesk','IBM Plex Sans Thai',sans-serif", fontWeight: 600, fontSize: 15.5, color: 'var(--a-ink)' }}>{L('Actionable alerts', 'แจ้งเตือนที่ต้องจัดการ')}</div>
          <div style={{ fontFamily: "'Hanken Grotesk','IBM Plex Sans Thai',sans-serif", fontSize: 11.5, color: 'var(--a-muted)', marginTop: 1, marginBottom: 12 }}>{L('Next 24–48 h', 'ใน 24–48 ชม.')}</div>
          <AAlert tone="warn" title={L('Wed 17:00 · Group', 'พ. 17:00 · กลุ่ม')} desc={L('3 booked · 5 waitlist', 'จอง 3 · คิว 5')} actions={[[L('Add class', 'เพิ่มคลาส'), true]]} />
          <AAlert tone="low" title={L('Thu 10:00 · Group', 'พฤ. 10:00 · กลุ่ม')} desc={L('1 booked / 3 · low', 'จอง 1/3 · น้อย')} actions={[[L('Promote', 'โปรโมต'), false], [L('Cancel', 'ยกเลิก'), 'rose']]} />
          <AAlert tone="low" title={L('Fri 08:00 · Group', 'ศ. 08:00 · กลุ่ม')} desc={L('0 booked / 3 · empty', 'จอง 0/3 · ว่าง')} actions={[[L('Promote', 'โปรโมต'), false], [L('Cancel', 'ยกเลิก'), 'rose']]} last />
        </div>

        {/* ── 03 RETENTION ── */}
        <ASecLabel n="03" title={L('Retention & CRM', 'รักษาลูกค้า')} top />

        <div style={aCard}>
          <div style={{ fontFamily: "'Schibsted Grotesk','IBM Plex Sans Thai',sans-serif", fontWeight: 600, fontSize: 15.5, color: 'var(--a-ink)' }}>{L('Expiring in 7 days', 'หมดอายุใน 7 วัน')}</div>
          <div style={{ fontFamily: "'Hanken Grotesk','IBM Plex Sans Thai',sans-serif", fontSize: 11.5, color: 'var(--a-muted)', marginTop: 1, marginBottom: 6 }}>{L('One tap nudges via LINE OA', 'แตะเพื่อส่งเตือนผ่าน LINE')}</div>
          {[['m2', '2.0', '8 Jun'], ['m6', '0.5', '4 Jun'], ['m9', '1.0', '6 Jun'], ['m3', '1.5', '7 Jun']].map((r) => <AExpRow key={r[0]} id={r[0]} hrs={r[1]} exp={r[2]} L={L} />)}
        </div>

        {/* house usage */}
        <div style={{ ...aCard, marginTop: 12 }}>
          <div style={{ fontFamily: "'Schibsted Grotesk','IBM Plex Sans Thai',sans-serif", fontWeight: 600, fontSize: 15.5, color: 'var(--a-ink)' }}>{L('House usage', 'การใช้แพ็กเกจครอบครัว')}</div>
          <div style={{ fontFamily: "'Hanken Grotesk','IBM Plex Sans Thai',sans-serif", fontSize: 11.5, color: 'var(--a-muted)', marginTop: 1, marginBottom: 12 }}>{L('Shared-package burn rate', 'อัตราการใช้แพ็กเกจรวม')}</div>
          <AHouse house="A-114" ids={['m1', 'm7', 'm3']} used={12} total={20} pct={60} color="#B5765C" note={L('Fast burn · refill ~10 days', 'ใช้เร็ว · เติมใน ~10 วัน')} L={L} warn />
          <AHouse house="C-007" ids={['m5']} used={8} total={24} pct={33} color="var(--a-sage)" note={L('Steady · healthy runway', 'สม่ำเสมอ · เหลือพอ')} L={L} />
          <AHouse house="B-203" ids={['m10']} used={14} total={16} pct={88} color="#B98C3E" note={L('Nearly spent · prompt renewal', 'ใกล้หมด · ควรเตือนต่ออายุ')} L={L} warn last />
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 16, padding: '0 2px', fontFamily: "'Hanken Grotesk','IBM Plex Sans Thai',sans-serif", fontSize: 11, color: 'var(--a-muted)', lineHeight: 1.5 }}>
          <Icon name="info" size={13} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>{L('Illustrative figures. Actions fire via LINE OA / webhooks in production.', 'ตัวเลขตัวอย่าง การทำงานจริงเชื่อม LINE OA / webhook')}</span>
        </div>
      </div>
    </div>
  );
}

// ── analytics sub-components ──
function ASecLabel({ n, title, top }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 9, margin: top ? '24px 2px 12px' : '2px 2px 12px' }}>
      <span style={{ fontFamily: "'Cormorant Garamond',serif", fontStyle: 'italic', fontSize: 19, color: 'var(--a-taupe)' }}>{n}</span>
      <span style={{ fontFamily: "'Schibsted Grotesk','IBM Plex Sans Thai',sans-serif", fontWeight: 600, fontSize: 16.5, color: 'var(--a-ink)', whiteSpace: 'nowrap' }}>{title}</span>
    </div>
  );
}

function ASpark() {
  const data = [12.1, 9.4, 14.8, 11.2, 16.0, 18.9, 22.4, 13.1, 15.6, 12.8, 17.2, 19.5, 14.9, 18.4];
  const max = 24, n = data.length;
  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ ...aEyebrowDark, marginBottom: 9 }}>{'Daily · last 14 days'}</div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 56 }}>
        {data.map((v, i) => {
          const isLast = i === n - 1;
          return (
            <div key={i} style={{ flex: 1, height: (v / max) * 100 + '%', minHeight: 4, borderRadius: '3px 3px 1px 1px', background: isLast ? '#F6EFE6' : 'rgba(201,184,158,0.55)' }} />
          );
        })}
      </div>
    </div>
  );
}

function AAlert({ tone, title, desc, actions, last }) {
  const tg = tone === 'warn'
    ? { bg: 'rgba(185,140,62,0.14)', col: '#B98C3E', icon: 'info' }
    : { bg: 'rgba(110,132,163,0.14)', col: '#6E84A3', icon: 'info' };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 12px', borderRadius: 13, border: '1px solid var(--a-line)', marginBottom: last ? 0 : 9 }}>
      <div style={{ width: 38, height: 38, borderRadius: 11, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: tg.bg, color: tg.col }}><Icon name={tg.icon} size={18} /></div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: "'Hanken Grotesk','IBM Plex Sans Thai',sans-serif", fontSize: 13.5, fontWeight: 600, color: 'var(--a-ink)' }}>{title}</div>
        <div style={{ fontFamily: "'Hanken Grotesk','IBM Plex Sans Thai',sans-serif", fontSize: 11.5, color: 'var(--a-muted)', marginTop: 1 }}>{desc}</div>
      </div>
      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
        {actions.map(([lb, kind], i) => (
          <button key={i} style={{ height: 32, padding: '0 11px', borderRadius: 9, cursor: 'pointer', fontFamily: "'Hanken Grotesk','IBM Plex Sans Thai',sans-serif", fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', border: kind === true ? 'none' : '1px solid ' + (kind === 'rose' ? 'rgba(181,118,92,0.4)' : 'var(--a-line-strong)'), background: kind === true ? 'var(--a-ink)' : 'transparent', color: kind === true ? '#fff' : kind === 'rose' ? '#B5765C' : 'var(--a-ink)' }}>{lb}</button>
        ))}
      </div>
    </div>
  );
}

function AExpRow({ id, hrs, exp, L }) {
  const { tt } = useM();
  const m = cust(id);
  const [sent, setSent] = React.useState(false);
  if (!m) return null;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '11px 0', borderTop: '1px solid var(--a-line)' }}>
      <Avatar id={id} size={36} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: "'Hanken Grotesk','IBM Plex Sans Thai',sans-serif", fontSize: 13.5, fontWeight: 600, color: 'var(--a-ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{tt(m.name)}</div>
        <div style={{ fontFamily: "'Hanken Grotesk','IBM Plex Sans Thai',sans-serif", fontSize: 11.5, color: 'var(--a-muted)', marginTop: 1 }}>{hrs} {L('h left', 'ชม.')} · <span style={{ color: '#B5765C', fontWeight: 600 }}>{L('exp', 'หมด')} {exp}</span></div>
      </div>
      <button onClick={() => setSent(true)} disabled={sent} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 34, padding: '0 12px', borderRadius: 10, border: 'none', cursor: sent ? 'default' : 'pointer', fontFamily: "'Hanken Grotesk','IBM Plex Sans Thai',sans-serif", fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', background: sent ? 'rgba(6,199,85,0.12)' : '#06C755', color: sent ? '#0a8f43' : '#fff' }}>
        <span style={{ width: 15, height: 15, borderRadius: 4, background: sent ? '#06C755' : '#fff', color: sent ? '#fff' : '#06C755', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 800 }}>L</span>
        {sent ? L('Sent', 'ส่งแล้ว') : L('Remind', 'เตือน')}
      </button>
    </div>
  );
}

function AHouse({ house, ids, used, total, pct, color, note, L, warn, last }) {
  return (
    <div style={{ padding: '12px 13px', border: '1px solid var(--a-line)', borderRadius: 13, marginBottom: last ? 0 : 9 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 9 }}>
        <span style={{ fontFamily: "'Schibsted Grotesk','IBM Plex Sans Thai',sans-serif", fontWeight: 600, fontSize: 14, color: 'var(--a-ink)', display: 'flex', alignItems: 'center', gap: 7 }}><Icon name="home" size={15} style={{ color: 'var(--a-taupe)' }} />{L('House', 'บ้าน')} {house}</span>
        <div style={{ display: 'flex' }}>{ids.map((id, i) => <span key={id} style={{ marginLeft: i ? -7 : 0, borderRadius: 99, border: '2px solid var(--a-surface-2)' }}><Avatar id={id} size={22} /></span>)}</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
        <div style={{ flex: 1, height: 7, borderRadius: 99, background: 'var(--a-cream-2)', overflow: 'hidden' }}><span style={{ display: 'block', height: '100%', width: pct + '%', background: color }} /></div>
        <span style={{ fontFamily: "'Schibsted Grotesk',sans-serif", fontWeight: 700, fontSize: 12.5, color: 'var(--a-ink)', whiteSpace: 'nowrap' }}>{used} / {total} {L('h', 'ชม.')}</span>
      </div>
      <div style={{ fontFamily: "'Hanken Grotesk','IBM Plex Sans Thai',sans-serif", fontSize: 11, color: warn ? '#B98C3E' : 'var(--a-muted)', marginTop: 8, fontWeight: warn ? 600 : 400 }}>{note}</div>
    </div>
  );
}

const aCard = { background: 'var(--a-surface-2)', border: '1px solid var(--a-line)', borderRadius: 16, padding: '16px 16px', boxShadow: 'var(--a-shadow)', marginBottom: 4 };
const aEyebrow = { fontFamily: "'Hanken Grotesk',sans-serif", fontSize: 10.5, fontWeight: 700, letterSpacing: '0.6px', textTransform: 'uppercase', color: 'var(--a-muted)' };
const aEyebrowDark = { fontFamily: "'Hanken Grotesk',sans-serif", fontSize: 10, fontWeight: 700, letterSpacing: '0.6px', textTransform: 'uppercase', color: 'rgba(243,236,226,0.5)' };

Object.assign(window, { MAnalytics, ASecLabel, ASpark, AAlert, AExpRow, AHouse });
