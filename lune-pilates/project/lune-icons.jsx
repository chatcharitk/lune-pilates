// lune-icons.jsx — thin line icons + the LUNE sparkle mark. currentColor.
function Icon({ name, size = 22, stroke = 1.5, style = {} }) {
  const p = { fill: 'none', stroke: 'currentColor', strokeWidth: stroke, strokeLinecap: 'round', strokeLinejoin: 'round' };
  const paths = {
    home: <><path {...p} d="M4 11.5 12 4l8 7.5"/><path {...p} d="M6 10.5V20h12v-9.5"/><path {...p} d="M10 20v-5h4v5"/></>,
    calendar: <><rect {...p} x="4" y="5.5" width="16" height="15" rx="3"/><path {...p} d="M4 9.5h16M8.5 3.5v4M15.5 3.5v4"/><circle cx="9" cy="14" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="14" r="1" fill="currentColor" stroke="none"/></>,
    bookings: <><path {...p} d="M6 3.5h12a1.5 1.5 0 0 1 1.5 1.5v15.5l-3-2-2 1.5-2-1.5-2 1.5-2-1.5-3 2V5A1.5 1.5 0 0 1 6 3.5Z"/><path {...p} d="M9 8.5h6M9 12h6"/></>,
    profile: <><circle {...p} cx="12" cy="8.5" r="3.5"/><path {...p} d="M5 20c0-3.6 3-6 7-6s7 2.4 7 6"/></>,
    bell: <><path {...p} d="M18 16H6l1.2-1.6V10a4.8 4.8 0 0 1 9.6 0v4.4Z"/><path {...p} d="M10 19a2 2 0 0 0 4 0"/></>,
    plus: <path {...p} d="M12 5v14M5 12h14"/>,
    clock: <><circle {...p} cx="12" cy="12" r="8"/><path {...p} d="M12 8v4.5l3 2"/></>,
    pin: <><path {...p} d="M12 21c4-4.5 6.5-7.7 6.5-11A6.5 6.5 0 0 0 5.5 10c0 3.3 2.5 6.5 6.5 11Z"/><circle {...p} cx="12" cy="10" r="2.3"/></>,
    person: <><circle {...p} cx="12" cy="8.5" r="3.2"/><path {...p} d="M6 19c0-3.2 2.7-5.2 6-5.2s6 2 6 5.2"/></>,
    chevR: <path {...p} d="M9 5l7 7-7 7"/>,
    chevL: <path {...p} d="M15 5l-7 7 7 7"/>,
    chevD: <path {...p} d="M5 9l7 7 7-7"/>,
    arrowR: <path {...p} d="M5 12h14M13 6l6 6-6 6"/>,
    check: <path {...p} d="M5 12.5l4.5 4.5L19 7"/>,
    checkCircle: <><circle {...p} cx="12" cy="12" r="8.5"/><path {...p} d="M8.5 12.2l2.4 2.4 4.6-4.8"/></>,
    info: <><circle {...p} cx="12" cy="12" r="8.5"/><path {...p} d="M12 11v5"/><circle cx="12" cy="7.8" r="1.05" fill="currentColor" stroke="none"/></>,
    qr: <><rect {...p} x="4" y="4" width="6" height="6" rx="1"/><rect {...p} x="14" y="4" width="6" height="6" rx="1"/><rect {...p} x="4" y="14" width="6" height="6" rx="1"/><path {...p} d="M14 14h2v2M20 14v6M14 20h6M18 17v.01"/></>,
    share: <><circle {...p} cx="7" cy="12" r="2.5"/><circle {...p} cx="17" cy="6" r="2.5"/><circle {...p} cx="17" cy="18" r="2.5"/><path {...p} d="M9.2 10.8 14.8 7.2M9.2 13.2 14.8 16.8"/></>,
    users: <><circle {...p} cx="9" cy="9" r="3"/><path {...p} d="M3.5 19c0-3 2.5-4.8 5.5-4.8s5.5 1.8 5.5 4.8"/><path {...p} d="M16 6.4a3 3 0 0 1 0 5.2M17.5 14.4c2.2.5 3.5 2.1 3.5 4.6"/></>,
    calPlus: <><rect {...p} x="4" y="5.5" width="16" height="15" rx="3"/><path {...p} d="M4 9.5h16M8.5 3.5v4M15.5 3.5v4M12 12.5v5M9.5 15h5"/></>,
    globe: <><circle {...p} cx="12" cy="12" r="8.5"/><path {...p} d="M3.5 12h17M12 3.5c2.5 2.4 2.5 14.6 0 17M12 3.5c-2.5 2.4-2.5 14.6 0 17"/></>,
    filter: <path {...p} d="M4 6h16M7 12h10M10 18h4"/>,
    x: <path {...p} d="M6 6l12 12M18 6 6 18"/>,
    reformer: <><rect {...p} x="3.5" y="9" width="17" height="6" rx="1.5"/><path {...p} d="M6 15v3M18 15v3M3.5 12h-1.5M22 12h-1.5"/></>,
    edit: <><path {...p} d="M4 20h4L19 9l-4-4L4 16v4Z"/><path {...p} d="M14 6l4 4"/></>,
    userPlus: <><circle {...p} cx="9" cy="8" r="3.4"/><path {...p} d="M3.5 19.5c0-3.1 2.5-5 5.5-5s5.5 1.9 5.5 5"/><path {...p} d="M18 8v6M15 11h6"/></>,
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ display: 'block', ...style }}>
      {paths[name] || null}
    </svg>
  );
}

// the 4-point sparkle from the logo
function Sparkle({ size = 16, color = 'currentColor', style = {} }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ display: 'block', ...style }}>
      <path d="M12 1.5c.5 6 4 9.5 10 10-6 .5-9.5 4-10 10-.5-6-4-9.5-10-10 6-.5 9.5-4 10-10Z" fill={color}/>
    </svg>
  );
}

Object.assign(window, { Icon, Sparkle });
