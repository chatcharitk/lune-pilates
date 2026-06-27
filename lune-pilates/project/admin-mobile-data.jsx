// admin-mobile-data.jsx — extends admin data with customers, POS, availability, gantt
// (admin-data.jsx must load first — A, ATYPES, AINSTR, MEMBERS, TODAY, bahtA already global)

// ── extra i18n (merged into A) ──
Object.assign(A, {
  customers:   { en: 'Customers', th: 'ลูกค้า' },
  customer:    { en: 'Customer', th: 'ลูกค้า' },
  pos:         { en: 'POS', th: 'ขายหน้าร้าน' },
  more:        { en: 'More', th: 'เพิ่มเติม' },
  add_customer:{ en: 'Add customer', th: 'เพิ่มลูกค้า' },
  new_customer:{ en: 'New customer', th: 'ลูกค้าใหม่' },
  all:         { en: 'All', th: 'ทั้งหมด' },
  members_only:{ en: 'Members', th: 'สมาชิก' },
  guests:      { en: 'Guests', th: 'ทั่วไป' },
  full_name:   { en: 'Full name', th: 'ชื่อ–นามสกุล' },
  phone:       { en: 'Phone number', th: 'เบอร์โทรศัพท์' },
  customer_type:{ en: 'Customer type', th: 'ประเภทลูกค้า' },
  house_no:    { en: 'House no. (village)', th: 'บ้านเลขที่ (หมู่บ้าน)' },
  house_hint:  { en: 'Required for member credit-sharing', th: 'จำเป็นสำหรับสิทธิแบ่งปันเครดิตของสมาชิก' },
  optional:    { en: 'optional', th: 'ไม่บังคับ' },
  save_customer:{ en: 'Save customer', th: 'บันทึกลูกค้า' },
  added_customer:{ en: 'Customer added', th: 'เพิ่มลูกค้าแล้ว' },
  added_sub:   { en: 'is ready to book classes and buy credits.', th: 'พร้อมจองคลาสและซื้อเครดิตแล้ว' },
  checkout:    { en: 'Checkout', th: 'ชำระเงิน' },
  new_sale:    { en: 'New sale', th: 'รายการขายใหม่' },
  packages_t:  { en: 'Packages', th: 'แพ็กเกจ' },
  retail:      { en: 'Retail', th: 'สินค้า' },
  cart:        { en: 'Cart', th: 'ตะกร้า' },
  empty_cart:  { en: 'Tap items to add them', th: 'แตะสินค้าเพื่อเพิ่ม' },
  subtotal:    { en: 'Subtotal', th: 'ยอดรวม' },
  charge:      { en: 'Charge', th: 'เรียกเก็บ' },
  assign_to:   { en: 'Assign to', th: 'ขายให้' },
  walk_in:     { en: 'Walk-in', th: 'ลูกค้าทั่วไป' },
  select_customer:{ en: 'Select customer', th: 'เลือกลูกค้า' },
  pay_cash:    { en: 'Cash', th: 'เงินสด' },
  pay_promptpay:{ en: 'PromptPay', th: 'พร้อมเพย์' },
  pay_card:    { en: 'Card', th: 'บัตร' },
  payment_method:{ en: 'Payment method', th: 'วิธีชำระเงิน' },
  complete_sale:{ en: 'Complete sale', th: 'ยืนยันการขาย' },
  sale_done:   { en: 'Sale complete', th: 'ขายสำเร็จ' },
  receipt:     { en: 'Send receipt via LINE', th: 'ส่งใบเสร็จทาง LINE' },
  new_sale_btn:{ en: 'New sale', th: 'ขายรายการใหม่' },
  qty:         { en: 'Qty', th: 'จำนวน' },
  availability:{ en: 'Availability', th: 'ตารางว่าง' },
  instr_avail: { en: 'Instructor availability', th: 'ตารางว่างของผู้สอน' },
  list_view:   { en: 'List', th: 'รายการ' },
  timeline_view:{ en: 'Timeline', th: 'ไทม์ไลน์' },
  day_off:     { en: 'Day off', th: 'วันหยุด' },
  available:   { en: 'Available', th: 'ว่าง' },
  add_hours:   { en: 'Add hours', th: 'เพิ่มเวลา' },
  edit_avail:  { en: 'Edit availability', th: 'แก้ไขเวลาว่าง' },
  classes_n:   { en: 'classes', th: 'คลาส' },
  free:        { en: 'Free', th: 'ว่าง' },
  today_classes:{ en: "Today's classes", th: 'คลาสวันนี้' },
  view_all:    { en: 'View all', th: 'ดูทั้งหมด' },
  quick_actions:{ en: 'Quick actions', th: 'เมนูด่วน' },
  manage_studio:{ en: 'Manage studio', th: 'จัดการสตูดิโอ' },
  switch_desktop:{ en: 'Open desktop view', th: 'เปิดมุมมองเดสก์ท็อป' },
  settings:    { en: 'Settings', th: 'ตั้งค่า' },
  joined:      { en: 'Joined', th: 'สมัครเมื่อ' },
  total_visits:{ en: 'visits', th: 'ครั้ง' },
  book_class:  { en: 'Book a class', th: 'จองคลาส' },
  sell_pkg:    { en: 'Sell package', th: 'ขายแพ็กเกจ' },
  call:        { en: 'Call', th: 'โทร' },
  no_credit:   { en: 'No credits', th: 'ไม่มีเครดิต' },
  add:         { en: 'Add', th: 'เพิ่ม' },
  done2:       { en: 'Done', th: 'เสร็จสิ้น' },
  // registration approval
  pending_approval:{ en: 'Awaiting approval', th: 'รออนุมัติ' },
  pending_filter:{ en: 'Pending', th: 'รออนุมัติ' },
  via_line:    { en: 'Registered via LINE', th: 'สมัครผ่าน LINE' },
  wants_pkg:   { en: 'Requested package', th: 'แพ็กเกจที่เลือก' },
  approve_title:{ en: 'New registration', th: 'การสมัครใหม่' },
  approve_note:{ en: 'This customer signed up through the LINE link. Confirm their payment to activate the account.', th: 'ลูกค้าสมัครผ่านลิงก์ LINE ยืนยันการชำระเงินเพื่อเปิดใช้งานบัญชี' },
  confirm_pay: { en: 'Confirm payment & approve', th: 'ยืนยันการชำระเงิน & อนุมัติ' },
  approved_title:{ en: 'Customer approved', th: 'อนุมัติแล้ว' },
  approved_sub:{ en: 'is now active. A LINE confirmation has been sent automatically.', th: 'เปิดใช้งานเรียบร้อย ส่งข้อความยืนยันทาง LINE ให้อัตโนมัติแล้ว' },
  line_sent:   { en: 'LINE confirmation sent', th: 'ส่งยืนยันทาง LINE แล้ว' },
  // staff
  team_staff:  { en: 'Team & staff', th: 'ทีมงาน' },
  add_staff:   { en: 'Add staff', th: 'เพิ่มทีมงาน' },
  new_staff:   { en: 'New staff member', th: 'ทีมงานใหม่' },
  role:        { en: 'Role', th: 'ตำแหน่ง' },
  role_instr:  { en: 'Instructor', th: 'ผู้สอน' },
  role_desk:   { en: 'Front desk', th: 'ต้อนรับ' },
  role_mgr:    { en: 'Manager', th: 'ผู้จัดการ' },
  specialty:   { en: 'Specialty', th: 'ความเชี่ยวชาญ' },
  save_staff:  { en: 'Save staff member', th: 'บันทึกทีมงาน' },
  staff_added: { en: 'Staff added', th: 'เพิ่มทีมงานแล้ว' },
  staff_added_sub:{ en: 'has been added to the team.', th: 'ถูกเพิ่มเข้าทีมแล้ว' },
  active_team: { en: 'Active team', th: 'ทีมงานปัจจุบัน' },
  // edit class
  edit_class:  { en: 'Edit class', th: 'แก้ไขคลาส' },
  capacity_c:  { en: 'Capacity', th: 'จำนวนที่รับ' },
  delete_class:{ en: 'Delete this class', th: 'ลบคลาสนี้' },
  class_updated:{ en: 'Class updated', th: 'แก้ไขคลาสแล้ว' },
  // analytics
  analytics_t: { en: 'Business analytics', th: 'วิเคราะห์ธุรกิจ' },
  analytics_sub:{ en: 'Sales · capacity · retention', th: 'ยอดขาย · ความจุ · รักษาลูกค้า' },
  biz_overview:{ en: 'Business overview', th: 'ภาพรวมธุรกิจ' },
});

// ── POS catalog ──
const POS_PACKAGES = [
  { id: 'drop', name: { en: 'Group Drop-in (1 hr)', th: 'กลุ่ม ดรอปอิน (1 ชม.)' }, price: 650, hours: 1, kind: 'pkg' },
  { id: 'p5',   name: { en: 'Group 5 hours', th: 'กลุ่ม 5 ชั่วโมง' }, price: 2950, hours: 5, kind: 'pkg' },
  { id: 'p10',  name: { en: 'Group 10 hours', th: 'กลุ่ม 10 ชั่วโมง' }, price: 5500, hours: 10, kind: 'pkg' },
  { id: 'p15',  name: { en: 'Group 15 hours', th: 'กลุ่ม 15 ชั่วโมง' }, price: 7500, hours: 15, kind: 'pkg' },
  { id: 'pv-drop', name: { en: '1:1 Drop-in', th: '1:1 ดรอปอิน' }, price: 1700, hours: 1, kind: 'pkg' },
  { id: 'pv8',  name: { en: '1:1 Pack (8 hr)', th: '1:1 แพ็ก (8 ชม.)' }, price: 12000, hours: 8, kind: 'pkg' },
  { id: 'duo8', name: { en: 'Duo Pack (8 hr)', th: 'ดูโอ แพ็ก (8 ชม.)' }, price: 14400, hours: 8, kind: 'pkg' },
  { id: 'trio8',name: { en: 'Trio Pack (8 hr)', th: 'ทรีโอ แพ็ก (8 ชม.)' }, price: 16000, hours: 8, kind: 'pkg' },
  { id: 'r-solo', name: { en: 'Studio Rental 1:1', th: 'เช่าสตูดิโอ 1:1' }, price: 600, hours: 1, kind: 'pkg' },
];
const POS_RETAIL = [
  { id: 'socks', name: { en: 'Grip socks', th: 'ถุงเท้ากันลื่น' }, price: 390, kind: 'retail' },
  { id: 'water', name: { en: 'Spring water', th: 'น้ำดื่ม' }, price: 40, kind: 'retail' },
  { id: 'towel', name: { en: 'Towel rental', th: 'เช่าผ้าขนหนู' }, price: 50, kind: 'retail' },
  { id: 'mat',   name: { en: 'Reformer towel', th: 'ผ้ารองรีฟอร์มเมอร์' }, price: 590, kind: 'retail' },
  { id: 'tote',  name: { en: 'LUNE tote bag', th: 'กระเป๋าผ้า LUNE' }, price: 450, kind: 'retail' },
  { id: 'bottle',name: { en: 'LUNE bottle', th: 'ขวดน้ำ LUNE' }, price: 690, kind: 'retail' },
];

// ── extra customers (non-members + new) so the list feels real ──
const EXTRA_CUSTOMERS = [
  { id: 'm9',  name: { en: 'Title Nattha', th: 'ไตเติ้ล ณัฐ' }, phone: '085 330 1192', house: '—', member: false, credits: 1.0, expiry: '6 Jun', share: [], status: 'active', joined: 'พ.ค. 2026', visits: 3 },
  { id: 'm10', name: { en: 'Praewa Suk', th: 'แพรวา สุข' }, phone: '091 552 8830', house: 'B-203', member: true, credits: 14.0, expiry: '20 Aug', share: ['m10'], status: 'active', joined: 'ม.ค. 2026', visits: 41 },
  { id: 'm11', name: { en: 'Earth Wirun', th: 'เอิร์ธ วิรุฬห์' }, phone: '082 901 4477', house: '—', member: false, credits: 0, expiry: '—', share: [], status: 'none', joined: 'วันนี้', visits: 0 },
  // ── pending registrations via LINE web link (awaiting payment confirmation) ──
  { id: 'pr1', name: { en: 'Mali Thongchai', th: 'มะลิ ทองชัย' }, phone: '087 412 9003', house: 'A-114', member: true, credits: 0, expiry: '—', share: [], status: 'pending', via: 'line', wantPkg: 'p10', regWhen: { en: '14 min ago', th: '14 นาทีที่แล้ว' }, joined: 'วันนี้', visits: 0 },
  { id: 'pr2', name: { en: 'Beam Sutthikul', th: 'บีม สุทธิกุล' }, phone: '090 778 2245', house: '—', member: false, credits: 0, expiry: '—', share: [], status: 'pending', via: 'line', wantPkg: 'drop', regWhen: { en: '1 hr ago', th: '1 ชม. ที่แล้ว' }, joined: 'วันนี้', visits: 0 },
];
// unified customer list — push extras into MEMBERS so mem()/Avatar resolve them
// enrich base members with joined/visits for detail view
MEMBERS.forEach((m, i) => { m.joined = m.joined || ['ก.พ. 2026','มี.ค. 2026','เม.ย. 2026','ม.ค. 2026','ม.ค. 2026','พ.ค. 2026','ก.พ. 2026','ธ.ค. 2025'][i] || 'พ.ค. 2026'; m.visits = m.visits != null ? m.visits : [28,12,19,53,48,4,22,31][i] || 10; });
EXTRA_CUSTOMERS.forEach((m) => { if (!MEMBERS.find((x) => x.id === m.id)) MEMBERS.push(m); });
const CUSTOMERS = MEMBERS;
function cust(id) { return MEMBERS.find((c) => c.id === id); }

// ── instructor day schedule for gantt (vertical timeline) ──
function gc(instr, time, dur, type) { return { instr, time, dur, type }; }
const GANTT_DAY = [
  gc('mai', '07:00', 50, 'group'),
  gc('mai', '09:00', 50, 'private'),
  gc('mai', '17:30', 50, 'group'),
  gc('ploy','08:00', 50, 'group'),
  gc('ploy','11:00', 50, 'duo'),
  gc('ploy','18:30', 50, 'group'),
  gc('nina','09:30', 60, 'private'),
  gc('nina','17:00', 50, 'trio'),
];
// working-hour windows per instructor (for gantt shading + availability)
const AVAIL_DAY = {
  mai:  [['07:00', '13:00'], ['17:00', '19:00']],
  ploy: [['08:00', '12:00'], ['17:00', '20:00']],
  nina: [['09:00', '12:00'], ['16:00', '18:30']],
};
const GANTT_START = 7;   // 07:00
const GANTT_END = 20;    // 20:00

// ── weekly availability per instructor (for the editor) ──
const DAYS_TH = { Mon:'จันทร์', Tue:'อังคาร', Wed:'พุธ', Thu:'พฤหัส', Fri:'ศุกร์', Sat:'เสาร์', Sun:'อาทิตย์' };
const AVAIL_WEEK = {
  mai: {
    Mon: [['07:00','13:00'],['17:00','19:00']], Tue: [['07:00','13:00']], Wed: [['07:00','12:00']],
    Thu: [['07:00','13:00'],['17:00','19:00']], Fri: [['07:00','13:00']], Sat: [['08:00','12:00']], Sun: [],
  },
  ploy: {
    Mon: [['08:00','12:00'],['17:00','20:00']], Tue: [['17:00','20:00']], Wed: [['08:00','12:00'],['17:00','20:00']],
    Thu: [['17:00','20:00']], Fri: [['08:00','12:00'],['17:00','20:00']], Sat: [['09:00','13:00']], Sun: [['09:00','12:00']],
  },
  nina: {
    Mon: [['09:00','12:00'],['16:00','18:30']], Tue: [['09:00','12:00']], Wed: [], Thu: [['09:00','12:00'],['16:00','18:30']],
    Fri: [['09:00','12:00']], Sat: [], Sun: [],
  },
};

function hhmmToFloat(t) { const [h, m] = t.split(':').map(Number); return h + m / 60; }
function floatToHHMM(f) { const h = Math.floor(f); const m = Math.round((f - h) * 60); return String(h).padStart(2,'0') + ':' + String(m).padStart(2,'0'); }

// ── staff & team (instructors + front desk) ──
const STAFF = [
  { id: 'mai',  role: 'role_instr', specialty: { en: 'Founder · Rehab', th: 'ผู้ก่อตั้ง · ฟื้นฟู' }, phone: '081 200 4567' },
  { id: 'ploy', role: 'role_instr', specialty: { en: 'Flow · Pre/Postnatal', th: 'โฟลว์ · ก่อน/หลังคลอด' }, phone: '089 553 2210' },
  { id: 'nina', role: 'role_instr', specialty: { en: 'Strength · Athletic', th: 'สร้างความแข็งแรง' }, phone: '062 778 9001' },
  { id: 'desk1', role: 'role_desk', name: { en: 'Som Reception', th: 'ส้ม ต้อนรับ' }, specialty: { en: 'Front desk · POS', th: 'ต้อนรับ · ขายหน้าร้าน' }, phone: '090 112 3344' },
];
function staffName(s) { return s.name || (AINSTR[s.id] && AINSTR[s.id].name) || { en: s.id, th: s.id }; }

// resolve a POS/package id to its display name
function pkgName(id) { const p = POS_PACKAGES.find((x) => x.id === id); return p ? p.name : { en: '—', th: '—' }; }

Object.assign(window, {
  POS_PACKAGES, POS_RETAIL, CUSTOMERS, cust, EXTRA_CUSTOMERS, STAFF, staffName, pkgName,
  GANTT_DAY, AVAIL_DAY, GANTT_START, GANTT_END, AVAIL_WEEK, DAYS_TH,
  hhmmToFloat, floatToHHMM,
});
