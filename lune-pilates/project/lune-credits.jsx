// lune-credits.jsx — Buy Credits / packages + PromptPay flow
function CreditsScreen() {
  const { t, tt, lang, back, credits, addCredits } = useLune();
  const [cat, setCat] = useState('group');
  const [selected, setSelected] = useState('p10');
  const [sheet, setSheet] = useState(null); // pay | done
  const activeCat = PACKAGE_CATS.find((c) => c.id === cat);
  const pkg = PACKAGES.find((p) => p.id === selected) || activeCat.items[0];

  function pickCat(id) {
    setCat(id);
    const c = PACKAGE_CATS.find((x) => x.id === id);
    // default selection per category
    const def = id === 'group' ? 'p10' : c.items[0].id;
    setSelected(def);
  }
  function paid() { if (pkg.cat === 'group') addCredits(pkg.hours); setSheet('done'); }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--cream)' }}>
      {/* header */}
      <div style={{ flexShrink: 0, padding: '52px 16px 8px', display: 'flex', alignItems: 'center', gap: 8, background: 'var(--cream)' }}>
        <button onClick={back} style={iconBtnStyle}><Icon name="chevL" size={20} /></button>
        <h1 style={{ margin: 0, fontFamily: 'var(--font-head)', fontWeight: 500, fontSize: 26, color: 'var(--ink)', letterSpacing: 0.2 }}>{t('packages')}</h1>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 22px 150px' }}>
        {/* balance recap */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)', padding: '14px 18px', boxShadow: 'var(--shadow-sm)', marginBottom: 18 }}>
          <div>
            <Eyebrow>{t('credits_remaining')}</Eyebrow>
            <div style={{ fontFamily: 'var(--font-head)', fontWeight: 600, fontSize: 26, color: 'var(--ink)', marginTop: 2 }}>{credits} <span style={{ fontFamily: 'var(--font-body)', fontWeight: 500, fontSize: 14, color: 'var(--taupe)' }}>{t('hours')}</span></div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--muted)' }}>{t('valid_until')}</div>
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 13.5, fontWeight: 600, color: 'var(--ink)', marginTop: 2 }}>{tt(USER.validUntil)}</div>
          </div>
        </div>

        {/* category segmented control */}
        <div style={{ display: 'flex', gap: 6, padding: 4, background: 'var(--cream-2)', borderRadius: 14, marginBottom: 16 }}>
          {PACKAGE_CATS.map((c) => (
            <button key={c.id} onClick={() => pickCat(c.id)} style={{
              flex: 1, padding: '9px 4px', borderRadius: 10, border: 'none', cursor: 'pointer',
              fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 600,
              background: cat === c.id ? 'var(--surface-2)' : 'transparent',
              color: cat === c.id ? 'var(--ink)' : 'var(--ink-soft)',
              boxShadow: cat === c.id ? 'var(--shadow-sm)' : 'none', transition: 'all .18s',
            }}>{t('cat_' + c.id)}</button>
          ))}
        </div>

        {/* category note */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, margin: '0 2px 14px', fontFamily: 'var(--font-body)', fontSize: 12.5, color: 'var(--muted)' }}>
          <Sparkle size={13} color="var(--taupe)" style={{ flexShrink: 0 }} />
          <span>{tt(activeCat.note)}</span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {activeCat.items.map((p) => <PackageCard key={p.id} p={p} on={selected === p.id} onClick={() => setSelected(p.id)} />)}
        </div>

        {/* trial promo (group only) */}
        {cat === 'group' && (
          <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 14, background: 'var(--ink)', borderRadius: 'var(--radius)', padding: '16px 18px', position: 'relative', overflow: 'hidden' }}>
            <Sparkle size={84} color="rgba(201,184,158,0.12)" style={{ position: 'absolute', top: -16, right: -12 }} />
            <div style={{ width: 44, height: 44, borderRadius: 12, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(201,184,158,0.16)' }}>
              <Sparkle size={22} color="#C9B89E" />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: 'var(--font-head)', fontWeight: 600, fontSize: 17, color: '#F3ECE2' }}>{t('trial_title')}</div>
              <p style={{ margin: '3px 0 0', fontFamily: 'var(--font-body)', fontSize: 12.5, lineHeight: 1.5, color: 'rgba(243,236,226,0.7)' }}>{t('trial_body')}</p>
            </div>
          </div>
        )}

        {/* shared non-transferable note */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 14, padding: '0 4px', fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--muted)' }}>
          <Icon name="info" size={13} style={{ flexShrink: 0 }} />
          <span>{lang === 'th' ? 'เครดิตในแพ็กเกจโอนสิทธิ์ไม่ได้ (ยกเว้นการแบ่งปันสำหรับสมาชิก)' : 'Credits are non-transferable (except member household sharing)'}</span>
        </div>

        {/* member perk */}
        <div style={{ marginTop: 16, background: 'linear-gradient(150deg, var(--cream-2), var(--surface))', border: '1px solid var(--line)', borderRadius: 'var(--radius)', padding: '18px 18px', position: 'relative', overflow: 'hidden' }}>
          <Sparkle size={90} color="rgba(140,122,99,0.06)" style={{ position: 'absolute', bottom: -20, right: -16 }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <Icon name="share" size={18} style={{ color: 'var(--taupe-deep)' }} />
            <span style={{ fontFamily: 'var(--font-head)', fontWeight: 600, fontSize: 17, color: 'var(--ink)' }}>{t('member_perk_title')}</span>
          </div>
          <p style={{ margin: 0, fontFamily: 'var(--font-body)', fontSize: 13, lineHeight: 1.58, color: 'var(--ink-soft)' }}>{t('member_perk_body')}</p>
          {USER.member && (
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 12, padding: '6px 12px', borderRadius: 99, background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
              <Icon name="pin" size={14} style={{ color: 'var(--taupe)' }} />
              <span style={{ fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 600, color: 'var(--ink-soft)' }}>{lang === 'th' ? 'บ้านเลขที่' : 'House'} {USER.house}</span>
            </div>
          )}
        </div>
      </div>

      {/* sticky checkout */}
      <div style={{ flexShrink: 0, padding: '14px 22px 30px', background: 'var(--surface-2)', borderTop: '1px solid var(--line)', boxShadow: '0 -10px 30px rgba(72,58,40,0.06)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ flexShrink: 0 }}>
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--muted)' }}>{t('total')}</div>
            <div style={{ fontFamily: 'var(--font-head)', fontWeight: 600, fontSize: 24, color: 'var(--ink)', lineHeight: 1.1 }}>{thb(pkg.price)}</div>
          </div>
          <div style={{ flex: 1 }}><PrimaryButton onClick={() => setSheet('pay')} icon="qr">{t('pay_promptpay')}</PrimaryButton></div>
        </div>
      </div>

      {/* PromptPay sheet */}
      <Sheet open={sheet === 'pay'} onClose={() => setSheet(null)} maxH="88%">
        <PromptPayContent pkg={pkg} onPaid={paid} />
      </Sheet>
      <Sheet open={sheet === 'done'} onClose={() => { setSheet(null); back(); }} maxH="64%">
        <PaymentDoneContent pkg={pkg} onDone={() => { setSheet(null); back(); }} />
      </Sheet>
    </div>
  );
}

// title + meta for a package, format-aware
function pkgTitle(p, t) {
  if (p.cat === 'group') return { big: String(p.hours), small: p.hours === 1 ? t('hour') : t('hours') };
  return { big: t(p.fmt), small: null };
}

function PackageCard({ p, on, onClick }) {
  const { t, tt, lang } = useLune();
  const tag = p.tag;
  const validKey = p.valid;
  const isGroup = p.cat === 'group';
  const title = pkgTitle(p, t);
  return (
    <button onClick={onClick} style={{
      width: '100%', textAlign: 'left', cursor: 'pointer', position: 'relative',
      border: '1.5px solid ' + (on ? 'var(--taupe)' : 'var(--line)'),
      background: on ? 'var(--surface-2)' : 'var(--surface)',
      borderRadius: 'var(--radius)', padding: '16px 18px', boxShadow: on ? 'var(--shadow-md)' : 'var(--shadow-sm)',
      transition: 'all .2s', display: 'flex', alignItems: 'center', gap: 14,
    }}>
      {/* radio */}
      <div style={{
        width: 24, height: 24, borderRadius: 99, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
        border: '1.5px solid ' + (on ? 'var(--taupe)' : 'var(--line-strong)'), background: on ? 'var(--taupe)' : 'transparent',
        color: '#fff', transition: 'all .2s',
      }}>{on && <Icon name="check" size={15} stroke={2.4} />}</div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
          <span style={{ fontFamily: 'var(--font-head)', fontWeight: 600, fontSize: isGroup ? 24 : 21, color: 'var(--ink)', lineHeight: 1.3, whiteSpace: 'nowrap' }}>{title.big}</span>
          {title.small && <span style={{ fontFamily: 'var(--font-body)', fontWeight: 500, fontSize: 13, lineHeight: 1.3, color: 'var(--taupe)' }}>{title.small}</span>}
          {tag && (
            <span style={{
              padding: '3px 9px', borderRadius: 99, fontFamily: 'var(--font-body)', fontSize: 10, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase',
              background: tag === 'best_value' ? 'var(--taupe)' : 'var(--cream-2)', color: tag === 'best_value' ? '#fff' : 'var(--taupe-deep)',
            }}>{t(tag)}</span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 7, fontFamily: 'var(--font-body)', fontSize: 12.5, lineHeight: 1.5, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
          {/* group: validity · per-hr  /  others: plan · per-hr */}
          <span>{isGroup ? t(validKey) : t(p.plan)}</span>
          <span style={{ width: 3, height: 3, borderRadius: 99, background: 'var(--line-strong)', flexShrink: 0 }} />
          <span>{thb(p.perHr)}{t('per_hour')}</span>
        </div>
      </div>

      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div style={{ fontFamily: 'var(--font-head)', fontWeight: 600, fontSize: 22, color: 'var(--ink)' }}>{thb(p.price)}</div>
      </div>
    </button>
  );
}

// (line-height fix applied above)
// QR placeholder — deterministic module pattern
function QRCode({ size = 188 }) {
  const n = 21;
  const cells = [];
  const isFinder = (r, c) => (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7);
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    if (isFinder(r, c)) continue;
    const v = (r * 31 + c * 17 + r * c * 7) % 11;
    if (v < 5) cells.push([r, c]);
  }
  const px = size / n;
  const finder = (x, y) => (
    <g key={`f${x}${y}`}>
      <rect x={x * px} y={y * px} width={px * 7} height={px * 7} rx={px} fill="var(--ink)" />
      <rect x={(x + 1) * px} y={(y + 1) * px} width={px * 5} height={px * 5} rx={px * 0.6} fill="var(--surface)" />
      <rect x={(x + 2) * px} y={(y + 2) * px} width={px * 3} height={px * 3} rx={px * 0.4} fill="var(--ink)" />
    </g>
  );
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ display: 'block' }}>
      {cells.map(([r, c]) => <rect key={`${r}-${c}`} x={c * px + px * 0.08} y={r * px + px * 0.08} width={px * 0.84} height={px * 0.84} rx={px * 0.3} fill="var(--ink)" />)}
      {finder(0, 0)}{finder(n - 7, 0)}{finder(0, n - 7)}
    </svg>
  );
}

function PromptPayContent({ pkg, onPaid }) {
  const { t, tt } = useLune();
  return (
    <div style={{ textAlign: 'center' }}>
      <h2 style={sheetTitle}>{t('scan_to_pay')}</h2>
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '6px 14px', borderRadius: 99, background: '#1A3A6B', color: '#fff', fontFamily: 'var(--font-body)', fontSize: 12.5, fontWeight: 700, letterSpacing: 0.3, marginBottom: 18 }}>
        PromptPay
      </div>
      <div style={{ background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 'var(--radius)', padding: '22px', margin: '0 auto', width: 'fit-content', boxShadow: 'var(--shadow-md)' }}>
        <QRCode size={186} />
      </div>
      <div style={{ margin: '14px auto 0', maxWidth: 260, fontFamily: 'var(--font-body)', fontSize: 13, lineHeight: 1.5, color: 'var(--muted)' }}>{t('scan_hint')}</div>
      <div style={{ marginTop: 16, borderRadius: 'var(--radius-sm)', border: '1px solid var(--line)', overflow: 'hidden' }}>
        <Line label={pkg.cat === 'group' ? `${pkg.hours} ${t('hours')}` : `${t(pkg.fmt)} · ${t(pkg.plan)}`} value={pkg.valid === 'single_visit' ? t('single_visit') : t('valid_for') + ' ' + t(pkg.valid)} />
        <Line label={t('amount')} value={thb(pkg.price)} last />
      </div>
      <div style={{ marginTop: 18 }}><PrimaryButton onClick={onPaid} icon="check">{t('ive_paid')}</PrimaryButton></div>
    </div>
  );
}

function PaymentDoneContent({ pkg, onDone }) {
  const { t } = useLune();
  return (
    <div style={{ textAlign: 'center', paddingTop: 8 }}>
      <div style={{ width: 76, height: 76, borderRadius: 99, margin: '4px auto 18px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--sage)', color: '#fff', boxShadow: '0 10px 30px rgba(140,154,126,0.4)' }}>
        <Icon name="check" size={36} stroke={2} />
      </div>
      <h2 style={{ margin: '0 0 8px', fontFamily: 'var(--font-head)', fontWeight: 600, fontSize: 30, color: 'var(--ink)' }}>{t('payment_done')}</h2>
      <p style={{ margin: '0 auto 20px', maxWidth: 280, fontFamily: 'var(--font-body)', fontSize: 14, lineHeight: 1.55, color: 'var(--ink-soft)' }}>{t('payment_sub')}</p>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '14px', borderRadius: 'var(--radius-sm)', background: 'var(--cream-2)', marginBottom: 18 }}>
        <Sparkle size={16} color="var(--taupe)" />
        <span style={{ fontFamily: 'var(--font-head)', fontWeight: 600, fontSize: 20, color: 'var(--ink)' }}>{pkg.cat === 'group' ? `+${pkg.hours} ${t('hours')}` : `${t(pkg.fmt)} · ${t(pkg.plan)}`}</span>
      </div>
      <PrimaryButton onClick={onDone}>{t('done')}</PrimaryButton>
    </div>
  );
}

Object.assign(window, { CreditsScreen, PackageCard, QRCode, PromptPayContent, PaymentDoneContent });
