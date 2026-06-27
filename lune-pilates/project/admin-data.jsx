// admin-data.jsx — sample data + i18n for the LUNE admin dashboard
const A = {
  // nav + chrome
  today:     { en: 'Today', th: 'วันนี้' },
  schedule:  { en: 'Schedule', th: 'ตารางคลาส' },
  bookings:  { en: 'Bookings', th: 'การจอง' },
  members:   { en: 'Members', th: 'สมาชิก' },
  payments:  { en: 'Payments', th: 'การชำระเงิน' },
  instructors:{ en: 'Instructors', th: 'ผู้สอน' },
  overview:  { en: "Today\u2019s overview", th: 'ภาพรวมวันนี้' },
  // stats
  classes_today: { en: 'Classes today', th: 'คลาสวันนี้' },
  attendees: { en: 'Attendees', th: 'ผู้เข้าเรียน' },
  checked_in:{ en: 'Checked in', th: 'เช็คอินแล้ว' },
  waitlisted:{ en: 'On waitlist', th: 'รอคิว' },
  revenue_mtd: { en: 'Revenue · June', th: 'รายได้ · มิ.ย.' },
  utilisation: { en: 'Utilisation', th: 'อัตราการใช้' },
  // labels
  instructor:{ en: 'Instructor', th: 'ผู้สอน' },
  capacity:  { en: 'Capacity', th: 'ความจุ' },
  status:    { en: 'Status', th: 'สถานะ' },
  roster:    { en: 'Roster', th: 'รายชื่อ' },
  check_in:  { en: 'Check in', th: 'เช็คอิน' },
  checked:   { en: 'Checked', th: 'เช็คแล้ว' },
  no_show:   { en: 'No-show', th: 'ไม่มา' },
  booked:    { en: 'Booked', th: 'จองแล้ว' },
  open:      { en: 'Open', th: 'ว่าง' },
  full:      { en: 'Full', th: 'เต็ม' },
  member:    { en: 'Member', th: 'สมาชิก' },
  guest:     { en: 'Guest', th: 'ทั่วไป' },
  new_class: { en: 'New class', th: 'สร้างคลาส' },
  edit:      { en: 'Edit', th: 'แก้ไข' },
  save:      { en: 'Save class', th: 'บันทึก' },
  cancel:    { en: 'Cancel', th: 'ยกเลิก' },
  search_members: { en: 'Search members…', th: 'ค้นหาสมาชิก…' },
  house:     { en: 'House', th: 'บ้านเลขที่' },
  sharing:   { en: 'Sharing', th: 'แบ่งปันเครดิต' },
  credits:   { en: 'Credits', th: 'เครดิต' },
  shared_grp:{ en: 'Shared group', th: 'กลุ่มแบ่งปัน' },
  notify:    { en: 'Notify', th: 'แจ้งเตือน' },
  notified:  { en: 'Notified', th: 'แจ้งแล้ว' },
  confirm_window: { en: 'Confirm window', th: 'เวลายืนยัน' },
  waitlist:  { en: 'Waitlist', th: 'คิวรอ' },
  all_bookings: { en: 'All bookings', th: 'การจองทั้งหมด' },
  hrs:       { en: 'hrs', th: 'ชม.' },
  active:    { en: 'Active', th: 'ใช้งาน' },
  expiring:  { en: 'Expiring soon', th: 'ใกล้หมดอายุ' },
  paid:      { en: 'Paid', th: 'ชำระแล้ว' },
  pending:   { en: 'Pending', th: 'รอชำระ' },
  view_roster: { en: 'View roster', th: 'ดูรายชื่อ' },
  manage:    { en: 'Manage', th: 'จัดการ' },
  today_long:{ en: 'Monday, 1 June 2026', th: 'วันจันทร์ที่ 1 มิถุนายน 2569' },
  greeting_admin: { en: 'Studio admin', th: 'ผู้ดูแลสตูดิโอ' },
  spots:     { en: 'spots', th: 'ที่' },
  reschedule:{ en: 'Reschedule', th: 'เลื่อน' },
  confirmed: { en: 'Confirmed', th: 'ยืนยันแล้ว' },
  this_week: { en: 'This week', th: 'สัปดาห์นี้' },
  new_members:{ en: 'New members', th: 'สมาชิกใหม่' },
  pkg_sales: { en: 'Package sales', th: 'ยอดขายแพ็กเกจ' },
};

const ATYPES = {
  group:   { label: { en: 'Reformer Group', th: 'รีฟอร์มเมอร์กลุ่ม' }, short: { en: 'Group', th: 'กลุ่ม' }, dot: '#A98F71', cap: 3 },
  private: { label: { en: 'Private 1:1', th: 'ส่วนตัว 1:1' }, short: { en: 'Private', th: 'ส่วนตัว' }, dot: '#8E9A82', cap: 1 },
  duo:     { label: { en: 'Duo', th: 'ดูโอ' }, short: { en: 'Duo', th: 'คู่' }, dot: '#C0A079', cap: 2 },
  trio:    { label: { en: 'Trio', th: 'ทรีโอ' }, short: { en: 'Trio', th: 'สาม' }, dot: '#B7A48C', cap: 3 },
  rental:  { label: { en: 'Studio Rental', th: 'เช่าสตูดิโอ' }, short: { en: 'Rental', th: 'เช่า' }, dot: '#A99B86', cap: 3 },
};

const AINSTR = {
  mai:  { name: { en: 'Kru Mai', th: 'ครูใหม่' }, initials: 'M', color: '#8C7A63' },
  ploy: { name: { en: 'Kru Ploy', th: 'ครูพลอย' }, initials: 'P', color: '#8E9A82' },
  nina: { name: { en: 'Kru Nina', th: 'ครูนีน่า' }, initials: 'N', color: '#C0A079' },
};

// members
const MEMBERS = [
  { id: 'm1', name: { en: 'Pim Srisai', th: 'พิม ศรีใส' }, phone: '081 234 5678', house: 'A-114', member: true, credits: 8, expiry: '24 Jun', share: ['m1', 'm7'], status: 'active' },
  { id: 'm2', name: { en: 'Nok Charoen', th: 'นก เจริญ' }, phone: '089 887 1200', house: 'B-203', member: true, credits: 2.0, expiry: '8 Jun', share: ['m2'], status: 'expiring' },
  { id: 'm3', name: { en: 'June Wattana', th: 'จูน วัฒนา' }, phone: '062 553 9981', house: 'A-114', member: false, credits: 5.0, expiry: '30 Jun', share: [], status: 'active' },
  { id: 'm4', name: { en: ' Best Pongsak', th: 'เบสท์ พงศักดิ์' }, phone: '084 119 2235', house: 'C-007', member: true, credits: 12.0, expiry: '15 Jul', share: ['m4', 'm5'], status: 'active' },
  { id: 'm5', name: { en: 'Fah Intira', th: 'ฟ้า อินทิรา' }, phone: '090 442 0087', house: 'C-007', member: true, credits: 12.0, expiry: '15 Jul', share: ['m4', 'm5'], status: 'active' },
  { id: 'm6', name: { en: 'Mind Arunee', th: 'มายด์ อรุณี' }, phone: '081 778 5512', house: 'D-051', member: false, credits: 0.5, expiry: '4 Jun', share: [], status: 'expiring' },
  { id: 'm7', name: { en: 'Gus Theerapat', th: 'กัส ธีรภัทร' }, phone: '083 901 7766', house: 'A-114', member: true, credits: 8, expiry: '24 Jun', share: ['m1', 'm7'], status: 'active' },
  { id: 'm8', name: { en: 'Ann Kanya', th: 'แอน กัญญา' }, phone: '086 220 4419', house: 'E-088', member: true, credits: 9.0, expiry: '2 Aug', share: ['m8'], status: 'active' },
];
function mem(id) { return MEMBERS.find((m) => m.id === id); }

// today's classes (Mon 1 Jun). roster = array of {member id, checked}
function tc(id, time, dur, type, instr, roster, wait) {
  return { id, time, dur, type, instr, roster: roster || [], wait: wait || [] };
}
const TODAY = [
  tc('t1', '07:00', 50, 'group', 'mai', [['m1', true], ['m3', true], ['m8', false]]),
  tc('t2', '09:30', 50, 'private', 'nina', [['m4', false]]),
  tc('t3', '11:00', 50, 'duo', 'ploy', [['m5', false], ['m2', false]]),
  tc('t4', '17:30', 50, 'group', 'mai', [['m1', false], ['m7', false], ['m8', false]], [['m6'], ['m2']]),
  tc('t5', '18:30', 50, 'group', 'ploy', [['m3', false], ['m4', false]]),
];

// week schedule for management view: per day counts
const ASCHED = [
  { d: 'Mon', date: 1, today: true, classes: 5 },
  { d: 'Tue', date: 2, classes: 4 },
  { d: 'Wed', date: 3, classes: 6 },
  { d: 'Thu', date: 4, classes: 4 },
  { d: 'Fri', date: 5, classes: 5 },
  { d: 'Sat', date: 6, classes: 6 },
  { d: 'Sun', date: 7, classes: 3 },
];

// bookings list
const BOOKINGS = [
  { id: 'b1', member: 'm1', type: 'group', day: 'Today', time: '07:00', status: 'checked' },
  { id: 'b2', member: 'm4', type: 'private', day: 'Today', time: '09:30', status: 'booked' },
  { id: 'b3', member: 'm5', type: 'duo', day: 'Today', time: '11:00', status: 'booked' },
  { id: 'b4', member: 'm8', type: 'group', day: 'Tomorrow', time: '08:00', status: 'booked' },
  { id: 'b5', member: 'm3', type: 'group', day: 'Today', time: '18:30', status: 'booked' },
  { id: 'b6', member: 'm2', type: 'trio', day: 'Wed', time: '12:00', status: 'confirmed' },
];

// waitlist entries: class, member, state, mins-left to confirm
const WAITLIST = [
  { id: 'w1', cls: 't4', member: 'm6', state: 'notified', mins: 22 },
  { id: 'w2', cls: 't4', member: 'm2', state: 'queued', pos: 2 },
  { id: 'w3', cls: 't1', member: 'm5', state: 'claimed' },
];

// payments
const PAYMENTS = [
  { id: 'p1', member: 'm4', pkg: '15 hours', amount: 7500, method: 'PromptPay', when: '09:12', status: 'paid' },
  { id: 'p2', member: 'm8', pkg: '10 hours', amount: 5500, method: 'PromptPay', when: 'Yesterday', status: 'paid' },
  { id: 'p3', member: 'm2', pkg: '5 hours', amount: 3000, method: 'PromptPay', when: 'Yesterday', status: 'pending' },
  { id: 'p4', member: 'm1', pkg: '10 hours', amount: 5500, method: 'PromptPay', when: '31 May', status: 'paid' },
  { id: 'p5', member: 'm6', pkg: 'Drop-in', amount: 650, method: 'PromptPay', when: '31 May', status: 'paid' },
];

function bahtA(n) { return '฿' + n.toLocaleString('en-US'); }

Object.assign(window, { A, ATYPES, AINSTR, MEMBERS, mem, TODAY, ASCHED, BOOKINGS, WAITLIST, PAYMENTS, bahtA });
