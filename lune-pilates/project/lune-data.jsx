// lune-data.jsx — content, i18n strings, class schedule, packages
// All bilingual fields are { en, th }. Exported to window.

// ───────────────────────── i18n UI strings ─────────────────────────
const STR = {
  // nav
  nav_home:     { en: 'Home',      th: 'หน้าแรก' },
  nav_schedule: { en: 'Schedule',  th: 'ตารางเรียน' },
  nav_bookings: { en: 'Bookings',  th: 'การจอง' },
  nav_profile:  { en: 'Profile',   th: 'โปรไฟล์' },

  // greetings
  greet_morning:   { en: 'Hello',   th: 'สวัสดีคุณ' },
  greet_afternoon: { en: 'Good afternoon', th: 'สวัสดีตอนบ่าย' },
  greet_evening:   { en: 'Good evening',   th: 'สวัสดีตอนเย็น' },

  // home
  credits_remaining: { en: 'Credits remaining', th: 'เครดิตคงเหลือ' },
  hours:        { en: 'hours',          th: 'ชั่วโมง' },
  hour:         { en: 'hour',           th: 'ชั่วโมง' },
  valid_until:  { en: 'Valid until',    th: 'หมดอายุ' },
  member:       { en: 'Member',         th: 'สมาชิก' },
  buy_credits:  { en: 'Buy credits',    th: 'ซื้อเครดิต' },
  book_a_class: { en: 'Book a class',   th: 'จองคลาส' },
  next_class:   { en: 'Your next class',th: 'คลาสถัดไปของคุณ' },
  this_week:    { en: 'This week',      th: 'สัปดาห์นี้' },
  see_all:      { en: 'See all',        th: 'ดูทั้งหมด' },
  starts_in:    { en: 'Starts in',      th: 'เริ่มในอีก' },
  today:        { en: 'Today',          th: 'วันนี้' },
  tomorrow:     { en: 'Tomorrow',       th: 'พรุ่งนี้' },
  view:         { en: 'View',           th: 'ดู' },

  // schedule
  filter_all:   { en: 'All',            th: 'ทั้งหมด' },
  spots_left:   { en: 'spots left',     th: 'ที่ว่าง' },
  spot_left:    { en: 'spot left',      th: 'ที่ว่าง' },
  full:         { en: 'Full',           th: 'เต็ม' },
  waitlist:     { en: 'Waitlist',       th: 'จองคิว' },
  morning:      { en: 'Morning',        th: 'ช่วงเช้า' },
  afternoon:    { en: 'Afternoon',      th: 'ช่วงบ่าย' },
  evening:      { en: 'Evening',        th: 'ช่วงเย็น' },
  no_classes:   { en: 'No classes scheduled', th: 'ไม่มีคลาสในวันนี้' },
  with_kru:     { en: 'with',           th: 'กับ' },

  // detail
  about_class:  { en: 'About this class', th: 'เกี่ยวกับคลาสนี้' },
  instructor:   { en: 'Instructor',     th: 'ผู้สอน' },
  duration:     { en: 'Duration',       th: 'ระยะเวลา' },
  capacity:     { en: 'Capacity',       th: 'จำนวนที่รับ' },
  location:     { en: 'Location',       th: 'สถานที่' },
  min:          { en: 'min',            th: 'นาที' },
  people:       { en: 'people',         th: 'คน' },
  reformers:    { en: 'reformers',      th: 'เครื่อง' },
  book_now:     { en: 'Book class',     th: 'จองคลาส' },
  join_waitlist:{ en: 'Join waitlist',  th: 'เข้าคิวรอ' },
  costs:        { en: 'Costs',          th: 'ใช้' },
  policy_title: { en: 'Cancellation policy', th: 'นโยบายการยกเลิก' },
  policy_body:  {
    en: 'Free cancel or reschedule up to 5 hours before class. After that, 1 credit is deducted.',
    th: 'ยกเลิกหรือเลื่อนได้ฟรีจนถึง 5 ชั่วโมงก่อนเริ่มคลาส หลังจากนั้นจะถูกหัก 1 เครดิต',
  },
  select_instructor: { en: 'Select instructor', th: 'เลือกผู้สอน' },
  spots_remaining: { en: 'Spots remaining', th: 'ที่นั่งคงเหลือ' },
  choose_position: { en: 'Choose your reformer', th: 'เลือกตำแหน่งเครื่อง' },
  pos_left:     { en: 'Left',   th: 'ซ้าย' },
  pos_middle:   { en: 'Middle', th: 'กลาง' },
  pos_right:    { en: 'Right',  th: 'ขวา' },
  pos_taken:    { en: 'Booked', th: 'ถูกจอง' },
  pos_open:     { en: 'Open',   th: 'ว่าง' },
  pos_selected: { en: 'Selected', th: 'ที่เลือก' },

  // booking flow
  confirm_booking: { en: 'Confirm booking', th: 'ยืนยันการจอง' },
  confirm:      { en: 'Confirm',         th: 'ยืนยัน' },
  cancel:       { en: 'Cancel',          th: 'ยกเลิก' },
  booked_title: { en: 'You\u2019re booked', th: 'จองสำเร็จแล้ว' },
  booked_sub:   { en: 'We can\u2019t wait to see you on the reformer.', th: 'แล้วพบกันที่สตูดิโอนะคะ' },
  add_calendar: { en: 'Add to calendar', th: 'เพิ่มลงปฏิทิน' },
  done:         { en: 'Done',            th: 'เสร็จสิ้น' },
  waitlist_title: { en: 'You\u2019re on the list', th: 'คุณอยู่ในคิวแล้ว' },
  waitlist_sub: { en: 'We\u2019ll notify you the moment a spot opens. You\u2019ll have 30 minutes to confirm.', th: 'เราจะแจ้งเตือนทันทีที่มีที่ว่าง คุณจะมีเวลา 30 นาทีในการยืนยัน' },
  remaining_after: { en: 'Balance after booking', th: 'คงเหลือหลังจอง' },

  // credits / packages
  packages:     { en: 'Packages',       th: 'แพ็กเกจ' },
  choose_package: { en: 'Choose a package', th: 'เลือกแพ็กเกจที่เหมาะกับคุณ' },
  per_hour:     { en: '/hr',            th: '/ชม.' },
  valid_for:    { en: 'Valid for',      th: 'ใช้ได้' },
  one_month:    { en: '1 month',        th: '1 เดือน' },
  two_months:   { en: '2 months',       th: '2 เดือน' },
  three_months: { en: '3 months',       th: '3 เดือน' },
  single_visit: { en: 'Single visit',   th: 'ครั้งเดียว' },
  best_value:   { en: 'Best value',     th: 'คุ้มที่สุด' },
  popular:      { en: 'Most popular',   th: 'ยอดนิยม' },
  non_transfer: { en: 'Non-transferable', th: 'โอนสิทธิ์ไม่ได้' },
  member_perk_title: { en: 'Member benefit \u00b7 Sharable credits', th: 'สิทธิสมาชิก \u00b7 แบ่งปันเครดิตได้' },
  member_perk_body: {
    en: 'Members can share unlimited credits with others at the same house number. Non-member packages cannot be shared.',
    th: 'สมาชิกสามารถแบ่งปันเครดิตได้ไม่จำกัดกับผู้ที่อยู่บ้านเลขที่เดียวกัน แพ็กเกจทั่วไปไม่สามารถแบ่งปันได้',
  },
  select:       { en: 'Select',         th: 'เลือก' },

  // package categories / formats
  cat_group:    { en: 'Group',          th: 'กลุ่ม' },
  cat_private:  { en: 'Private',        th: 'ส่วนตัว' },
  cat_rental:   { en: 'Rental',         th: 'เช่าสตูดิโอ' },
  fmt_solo:     { en: '1:1',            th: '1:1' },
  fmt_duo:      { en: 'Duo',            th: 'ดูโอ' },
  fmt_trio:     { en: 'Trio',           th: 'ทรีโอ' },
  plan_drop:    { en: 'Drop-in',        th: 'ดรอปอิน' },
  plan_pack8:   { en: '8-hour pack',    th: 'แพ็ก 8 ชม.' },
  plan_rental:  { en: 'Full apparatus', th: 'อุปกรณ์ครบชุด' },
  trial_title:  { en: 'Trial · Buy 1 Get 1', th: 'ทดลอง · ซื้อ 1 แถม 1' },
  trial_body:   { en: 'First time at LUNE? Your trial class comes with a second session free.', th: 'มาครั้งแรกที่ LUNE? รับคลาสทดลองฟรีอีกหนึ่งครั้ง' },
  trial_cta:    { en: 'Claim trial offer', th: 'รับสิทธิ์ทดลอง' },
  per_session:  { en: '/session',       th: '/ครั้ง' },
  pay_promptpay:{ en: 'Pay with PromptPay', th: 'ชำระผ่านพร้อมเพย์' },
  scan_to_pay:  { en: 'Scan to pay',    th: 'สแกนเพื่อชำระเงิน' },
  scan_hint:    { en: 'Open your banking app and scan this QR code', th: 'เปิดแอปธนาคารแล้วสแกน QR นี้' },
  amount:       { en: 'Amount',         th: 'จำนวนเงิน' },
  ive_paid:     { en: 'I\u2019ve paid',  th: 'ชำระเงินแล้ว' },
  payment_done: { en: 'Payment received', th: 'รับชำระเงินแล้ว' },
  payment_sub:  { en: 'Your credits have been added to your account.', th: 'เพิ่มเครดิตเข้าบัญชีของคุณเรียบร้อยแล้ว' },
  total:        { en: 'Total',          th: 'รวม' },
  expires:      { en: 'expires', th: 'หมดอายุ' },
  open_hours:   { en: 'Open daily 8:00–20:00', th: 'เปิดทุกวัน 8:00–20:00' },

  // reschedule / cancel
  reschedule:   { en: 'Reschedule',     th: 'เลื่อนเวลา' },
  resched_title:{ en: 'Reschedule class', th: 'เลื่อนเวลาเรียน' },
  resched_pick: { en: 'Choose a new time', th: 'เลือกเวลาใหม่' },
  current_time: { en: 'Currently booked', th: 'เวลาที่จองไว้' },
  keep_time:    { en: 'Keep current time', th: 'ใช้เวลาเดิม' },
  confirm_resched: { en: 'Confirm new time', th: 'ยืนยันเวลาใหม่' },
  resched_done: { en: 'Class rescheduled', th: 'เลื่อนเวลาเรียบร้อย' },
  resched_done_sub: { en: 'Your new time is confirmed. See you on the reformer.', th: 'ยืนยันเวลาใหม่เรียบร้อยแล้ว แล้วพบกันนะคะ' },
  cancel_class: { en: 'Cancel class',     th: 'ยกเลิกคลาส' },
  cancel_title: { en: 'Cancel this class?', th: 'ยกเลิกคลาสนี้?' },
  keep_booking: { en: 'Keep my booking',  th: 'เก็บการจองไว้' },
  free_cancel:  { en: 'Free cancellation', th: 'ยกเลิกได้ฟรี' },
  free_cancel_sub: { en: 'You\u2019re outside the 5-hour window. No credit will be deducted.', th: 'คุณยกเลิกก่อน 5 ชั่วโมง จะไม่ถูกหักเครดิต' },
  late_cancel:  { en: 'Within 5 hours',   th: 'ภายใน 5 ชั่วโมง' },
  late_cancel_sub: { en: 'You\u2019re inside the 5-hour window. 1 credit will be deducted.', th: 'คุณอยู่ในช่วง 5 ชั่วโมงก่อนเรียน จะถูกหัก 1 เครดิต' },
  cancelled_title: { en: 'Booking cancelled', th: 'ยกเลิกการจองแล้ว' },
  cancelled_free_sub: { en: 'Your credit has been returned to your balance.', th: 'เครดิตของคุณถูกคืนเข้าบัญชีแล้ว' },
  cancelled_late_sub: { en: '1 credit was deducted as per the cancellation policy.', th: 'ถูกหัก 1 เครดิตตามนโยบายการยกเลิก' },
  time_until_class: { en: 'until class', th: 'ก่อนเริ่มคลาส' },
  no_other_times: { en: 'No other times this week', th: 'ไม่มีเวลาอื่นในสัปดาห์นี้' },
};

// ───────────────────────── class types ─────────────────────────
const TYPES = {
  group:   { key: 'group',   label: { en: 'Reformer Group', th: 'รีฟอร์มเมอร์กลุ่ม' }, short: { en: 'Group', th: 'กลุ่ม' }, dot: '#A98F71', cap: 3, selInstructor: false,
             blurb: { en: 'A flowing full-body reformer class for up to three. Springs, straps and breath \u2014 instructor assigned.', th: 'คลาสรีฟอร์มเมอร์เต็มตัวสำหรับสูงสุดสามคน เน้นการไหลลื่นและลมหายใจ จัดผู้สอนให้' } },
  private: { key: 'private', label: { en: 'Private 1:1', th: 'ส่วนตัว 1:1' }, short: { en: 'Private', th: 'ส่วนตัว' }, dot: '#8E9A82', cap: 1, selInstructor: true,
             blurb: { en: 'One-to-one session tailored to your body and goals, with the instructor of your choice.', th: 'คลาสตัวต่อตัวออกแบบเฉพาะคุณ พร้อมเลือกผู้สอนที่ต้องการ' } },
  duo:     { key: 'duo',     label: { en: 'Duo', th: 'ดูโอ (คู่)' }, short: { en: 'Duo', th: 'คู่' }, dot: '#C0A079', cap: 2, selInstructor: true,
             blurb: { en: 'Train side by side with a partner \u2014 shared focus, personal attention.', th: 'ฝึกเคียงข้างคู่ของคุณ ใส่ใจเป็นรายบุคคล' } },
  trio:    { key: 'trio',    label: { en: 'Trio', th: 'ทรีโอ (สาม)' }, short: { en: 'Trio', th: 'สาม' }, dot: '#B7A48C', cap: 3, selInstructor: true,
             blurb: { en: 'A small group of three \u2014 the energy of a class with hands-on guidance.', th: 'กลุ่มเล็กสามคน ได้พลังของคลาสพร้อมการดูแลใกล้ชิด' } },
  rental:  { key: 'rental',  label: { en: 'Studio Rental', th: 'เช่าสตูดิโอ' }, short: { en: 'Rental', th: 'เช่า' }, dot: '#A99B86', cap: 3, selInstructor: false,
             blurb: { en: 'Rent the reformer space for your own practice \u2014 1:1, Duo or Trio.', th: 'เช่าพื้นที่รีฟอร์มเมอร์เพื่อฝึกเอง รองรับ 1:1 ดูโอ หรือทรีโอ' } },
};

// ───────────────────────── instructors ─────────────────────────
const INSTRUCTORS = {
  mai:  { id: 'mai',  name: { en: 'Kru Mai',  th: 'ครูใหม่' },  tag: { en: 'Founder \u00b7 Rehab', th: 'ผู้ก่อตั้ง \u00b7 ฟื้นฟู' },  initials: 'M' },
  ploy: { id: 'ploy', name: { en: 'Kru Ploy', th: 'ครูพลอย' }, tag: { en: 'Flow \u00b7 Pre/Postnatal', th: 'โฟลว์ \u00b7 ก่อน/หลังคลอด' }, initials: 'P' },
  nina: { id: 'nina', name: { en: 'Kru Nina', th: 'ครูนีน่า' }, tag: { en: 'Strength \u00b7 Athletic', th: 'สร้างความแข็งแรง' }, initials: 'N' },
};

// ───────────────────────── the week ─────────────────────────
// today = Mon 1 Jun 2026. days indexed 1..7
const WEEK = [
  { d: 1, dow: { en: 'Mon', th: 'จ.' }, date: 1, today: true },
  { d: 2, dow: { en: 'Tue', th: 'อ.' }, date: 2 },
  { d: 3, dow: { en: 'Wed', th: 'พ.' }, date: 3 },
  { d: 4, dow: { en: 'Thu', th: 'พฤ.' }, date: 4 },
  { d: 5, dow: { en: 'Fri', th: 'ศ.' }, date: 5 },
  { d: 6, dow: { en: 'Sat', th: 'ส.' }, date: 6 },
  { d: 7, dow: { en: 'Sun', th: 'อา.' }, date: 7 },
];
const MONTH = { en: 'June 2026', th: 'มิถุนายน 2569' };

// sessions: id, day, time, dur, type, instr, booked
function mk(id, day, time, dur, type, instr, booked) {
  return { id, day, time, dur, type, instr, booked };
}
const SESSIONS = [
  // ── Baseline group schedule (cap 3) + private/duo/trio/rental by appointment ──
  // Mon (today) · M/W/F group: 08, 09, 16, 17
  mk('s1',  1, '08:00', 60, 'group', null, 1),
  mk('s2',  1, '09:00', 60, 'group', null, 0),
  mk('s3',  1, '11:00', 50, 'private', 'mai', 0),
  mk('s4',  1, '16:00', 60, 'group', null, 3),  // full
  mk('s5',  1, '17:00', 60, 'group', null, 2),
  mk('s6',  1, '18:30', 50, 'duo', 'ploy', 1),
  // Tue · Tu/Th group: 09, 10, 17, 18
  mk('s7',  2, '09:00', 60, 'group', null, 2),
  mk('s8',  2, '10:00', 60, 'group', null, 0),
  mk('s9',  2, '13:00', 50, 'private', 'nina', 0),
  mk('s10', 2, '17:00', 60, 'group', null, 1),
  mk('s11', 2, '18:00', 60, 'group', null, 3),  // full
  // Wed · M/W/F group: 08, 09, 16, 17
  mk('s12', 3, '08:00', 60, 'group', null, 0),
  mk('s13', 3, '09:00', 60, 'group', null, 1),
  mk('s14', 3, '12:00', 50, 'trio', 'ploy', 1),
  mk('s15', 3, '16:00', 60, 'group', null, 2),
  mk('s16', 3, '17:00', 60, 'group', null, 3),  // full
  // Thu · Tu/Th group: 09, 10, 17, 18
  mk('s17', 4, '09:00', 60, 'group', null, 1),
  mk('s18', 4, '10:00', 60, 'group', null, 2),
  mk('s19', 4, '11:00', 90, 'rental', null, 0),
  mk('s20', 4, '17:00', 60, 'group', null, 0),
  mk('s21', 4, '18:00', 60, 'group', null, 1),
  // Fri · M/W/F group: 08, 09, 16, 17
  mk('s22', 5, '08:00', 60, 'group', null, 2),
  mk('s23', 5, '09:00', 60, 'group', null, 1),
  mk('s24', 5, '14:00', 50, 'duo', 'nina', 0),
  mk('s25', 5, '16:00', 60, 'group', null, 3),  // full
  mk('s26', 5, '17:00', 60, 'group', null, 2),
  // Sat · Sat/Sun group: 09, 10, 11, 17
  mk('s27', 6, '09:00', 60, 'group', null, 1),
  mk('s28', 6, '10:00', 60, 'group', null, 2),
  mk('s29', 6, '11:00', 60, 'group', null, 0),
  mk('s30', 6, '14:30', 50, 'private', 'ploy', 0),
  mk('s31', 6, '17:00', 60, 'group', null, 1),
  // Sun · Sat/Sun group: 09, 10, 11, 17
  mk('s32', 7, '09:00', 60, 'group', null, 0),
  mk('s33', 7, '10:00', 60, 'group', null, 2),
  mk('s34', 7, '11:00', 60, 'group', null, 1),
  mk('s35', 7, '15:00', 50, 'trio', 'mai', 2),
  mk('s36', 7, '17:00', 60, 'group', null, 3),  // full
];

// the user
const USER = {
  name: { en: 'Pim', th: 'พิม' },
  credits: 8,
  validUntil: { en: '24 Jun 2026', th: '24 มิ.ย. 2569' },
  member: true,
  house: 'A-114',
  // next booking
  next: { sessionId: 's5', type: 'group', day: 1, date: { en: 'Today', th: 'วันนี้' }, time: '17:00', dur: 60 },
};

// ───────────────────────── packages ─────────────────────────
// Categorised catalog. Group = hour-credits (sharable for members).
// Private/Duo/Trio = format packs. Rental = per-hour apparatus.
const PACKAGE_CATS = [
  {
    id: 'group',
    label: { en: 'Group Class', th: 'คลาสกลุ่ม' },
    note: { en: 'Hour credits · sharable for members', th: 'เครดิตชั่วโมง · สมาชิกแบ่งปันได้' },
    mode: 'hours',
    items: [
      { id: 'drop', cat: 'group', hours: 1,  price: 650,  valid: 'single_visit', perHr: 650, tag: null },
      { id: 'p5',   cat: 'group', hours: 5,  price: 2950, valid: 'one_month',    perHr: 590, tag: null },
      { id: 'p10',  cat: 'group', hours: 10, price: 5500, valid: 'two_months',   perHr: 550, tag: 'popular' },
      { id: 'p15',  cat: 'group', hours: 15, price: 7500, valid: 'three_months', perHr: 500, tag: 'best_value' },
    ],
  },
  {
    id: 'private',
    label: { en: 'Private & Semi', th: 'ส่วนตัว & กลุ่มเล็ก' },
    note: { en: 'Choose your instructor · 8-hr packs valid 2 months', th: 'เลือกผู้สอน · แพ็ก 8 ชม. ใช้ได้ 2 เดือน' },
    mode: 'format',
    items: [
      { id: 'pv-drop',   cat: 'private', fmt: 'fmt_solo', plan: 'plan_drop',  hours: 1, price: 1700,  valid: 'single_visit', perHr: 1700, tag: null },
      { id: 'pv8',       cat: 'private', fmt: 'fmt_solo', plan: 'plan_pack8', hours: 8, price: 12000, valid: 'two_months',   perHr: 1500, tag: 'best_value' },
      { id: 'duo-drop',  cat: 'private', fmt: 'fmt_duo',  plan: 'plan_drop',  hours: 1, price: 2000,  valid: 'single_visit', perHr: 2000, tag: null },
      { id: 'duo8',      cat: 'private', fmt: 'fmt_duo',  plan: 'plan_pack8', hours: 8, price: 14400, valid: 'two_months',   perHr: 1800, tag: null },
      { id: 'trio-drop', cat: 'private', fmt: 'fmt_trio', plan: 'plan_drop',  hours: 1, price: 2200,  valid: 'single_visit', perHr: 2200, tag: null },
      { id: 'trio8',     cat: 'private', fmt: 'fmt_trio', plan: 'plan_pack8', hours: 8, price: 16000, valid: 'two_months',   perHr: 2000, tag: null },
    ],
  },
  {
    id: 'rental',
    label: { en: 'Studio Rental', th: 'เช่าสตูดิโอ' },
    note: { en: 'Full apparatus · per hour', th: 'อุปกรณ์ครบชุด · ต่อชั่วโมง' },
    mode: 'format',
    items: [
      { id: 'r-solo', cat: 'rental', fmt: 'fmt_solo', plan: 'plan_rental', hours: 1, price: 600,  valid: 'single_visit', perHr: 600,  tag: null },
      { id: 'r-duo',  cat: 'rental', fmt: 'fmt_duo',  plan: 'plan_rental', hours: 1, price: 800,  valid: 'single_visit', perHr: 800,  tag: null },
      { id: 'r-trio', cat: 'rental', fmt: 'fmt_trio', plan: 'plan_rental', hours: 1, price: 1000, valid: 'single_visit', perHr: 1000, tag: null },
    ],
  },
];
const PACKAGES = PACKAGE_CATS.reduce((a, c) => a.concat(c.items), []);

function thb(n) { return '฿' + n.toLocaleString('en-US'); }

Object.assign(window, { STR, TYPES, INSTRUCTORS, WEEK, MONTH, SESSIONS, USER, PACKAGES, PACKAGE_CATS, thb });
