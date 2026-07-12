// Bilingual UI string catalog (EN/TH). Seeded from
// lune-pilates/project/lune-data.jsx (STR). Every user-facing string is keyed —
// no hardcoded copy in components. Extend as screens are built.

export type Lang = "en" | "th";
export type Bilingual = { en: string; th: string };

export const STR = {
  // nav
  nav_home: { en: "Home", th: "หน้าแรก" },
  nav_schedule: { en: "Schedule", th: "ตารางเรียน" },
  nav_bookings: { en: "Bookings", th: "การจอง" },
  nav_profile: { en: "Profile", th: "โปรไฟล์" },

  // greetings
  greet_morning: { en: "Hello", th: "สวัสดีคุณ" },
  greet_afternoon: { en: "Good afternoon", th: "สวัสดีตอนบ่าย" },
  greet_evening: { en: "Good evening", th: "สวัสดีตอนเย็น" },

  // home
  credits_remaining: { en: "Credits remaining", th: "เครดิตคงเหลือ" },
  hours: { en: "hours", th: "ชั่วโมง" },
  hour: { en: "hour", th: "ชั่วโมง" },
  valid_until: { en: "Valid until", th: "หมดอายุ" },
  member: { en: "Member", th: "สมาชิก" },
  household: { en: "Household", th: "ครัวเรือน" },
  shared_pool: { en: "Shared pool", th: "เครดิตรวมของบ้าน" },
  buy_credits: { en: "Buy credits", th: "ซื้อเครดิต" },
  book_a_class: { en: "Book a class", th: "จองคลาส" },
  next_class: { en: "Your next class", th: "คลาสถัดไปของคุณ" },
  this_week: { en: "This week", th: "สัปดาห์นี้" },
  see_all: { en: "See all", th: "ดูทั้งหมด" },
  today: { en: "Today", th: "วันนี้" },
  tomorrow: { en: "Tomorrow", th: "พรุ่งนี้" },
  view: { en: "View", th: "ดู" },
  with_kru: { en: "with", th: "กับ" },
  // home banner shown when the viewer has a live (`offered`) waitlist hold.
  spot_opened_banner: { en: "A spot opened — confirm now", th: "มีที่ว่าง — ยืนยันเลย" },
  // next-class countdown lead-in (mirrors lune-data.jsx STR.starts_in), followed
  // by the formatted "Xh Ym" / "X ชม. Y นาที" remaining time.
  starts_in: { en: "Starts in", th: "เริ่มในอีก" },

  // schedule
  filter_all: { en: "All", th: "ทั้งหมด" },
  spots_left: { en: "spots left", th: "ที่ว่าง" },
  spot_left: { en: "spot left", th: "ที่ว่าง" },
  full: { en: "Full", th: "เต็ม" },
  waitlist: { en: "Waitlist", th: "จองคิว" },
  morning: { en: "Morning", th: "ช่วงเช้า" },
  afternoon: { en: "Afternoon", th: "ช่วงบ่าย" },
  evening: { en: "Evening", th: "ช่วงเย็น" },
  no_classes: { en: "No classes scheduled", th: "ไม่มีคลาสในวันนี้" },
  min: { en: "min", th: "นาที" },
  prev_week: { en: "Previous week", th: "สัปดาห์ก่อนหน้า" },
  next_week: { en: "Next week", th: "สัปดาห์ถัดไป" },

  // class-type filter labels (mirror TYPES[*].short)
  type_group: { en: "Group", th: "กลุ่ม" },
  type_private: { en: "Private", th: "ส่วนตัว" },
  type_duo: { en: "Duo", th: "คู่" },
  type_trio: { en: "Trio", th: "สาม" },
  type_rental: { en: "Rental", th: "เช่า" },

  // detail
  about_class: { en: "About this class", th: "เกี่ยวกับคลาสนี้" },
  when: { en: "When", th: "เวลา" },
  instructor: { en: "Instructor", th: "ผู้สอน" },
  duration: { en: "Duration", th: "ระยะเวลา" },
  capacity: { en: "Capacity", th: "จำนวนที่รับ" },
  location: { en: "Location", th: "สถานที่" },
  people: { en: "people", th: "คน" },
  reformers: { en: "reformers", th: "เครื่อง" },
  studio_name: { en: "LUNE Studio", th: "LUNE สตูดิโอ" },
  studio_level: { en: "Level 3", th: "ชั้น 3" },
  book_now: { en: "Book class", th: "จองคลาส" },
  join_waitlist: { en: "Join waitlist", th: "เข้าคิวรอ" },
  costs: { en: "Costs", th: "ใช้" },

  // reformer position picker
  spots_remaining: { en: "Spots remaining", th: "ที่นั่งคงเหลือ" },
  choose_position: { en: "Choose your reformer", th: "เลือกตำแหน่งเครื่อง" },
  open_count: { en: "open", th: "ที่" },
  pos_left: { en: "Left", th: "ซ้าย" },
  pos_middle: { en: "Middle", th: "กลาง" },
  pos_right: { en: "Right", th: "ขวา" },
  pos_taken: { en: "Booked", th: "ถูกจอง" },
  pos_open: { en: "Open", th: "ว่าง" },
  pos_selected: { en: "Selected", th: "ที่เลือก" },

  // booking flow
  confirm_booking: { en: "Confirm booking", th: "ยืนยันการจอง" },
  confirm: { en: "Confirm", th: "ยืนยัน" },
  cancel: { en: "Cancel", th: "ยกเลิก" },
  booked_title: { en: "You’re booked", th: "จองสำเร็จแล้ว" },
  booked_sub: {
    en: "We can’t wait to see you on the reformer.",
    th: "แล้วพบกันที่สตูดิโอนะคะ",
  },
  done: { en: "Done", th: "เสร็จสิ้น" },
  waitlist_title: { en: "You’re on the list", th: "คุณอยู่ในคิวแล้ว" },
  waitlist_sub: {
    en: "We’ll notify you the moment a spot opens. You’ll have 30 minutes to confirm.",
    th: "เราจะแจ้งเตือนทันทีที่มีที่ว่าง คุณจะมีเวลา 30 นาทีในการยืนยัน",
  },
  // FIFO queue position from the backend join result ("Position 2" / "ลำดับที่ 2").
  waitlist_position: { en: "Position {n}", th: "ลำดับที่ {n}" },
  remaining_after: { en: "Balance after booking", th: "คงเหลือหลังจอง" },
  policy_title: { en: "Cancellation policy", th: "นโยบายการยกเลิก" },
  // Success-screen policy notice — the window ({hours}) and cost ({cost}) are
  // interpolated from the bookClass result (freeCancelHours is always 5).
  booked_policy: {
    en: "Cancel at least {hours} before class, or {cost} will be deducted.",
    th: "ยกเลิกอย่างน้อย {hours} ก่อนเริ่มคลาส มิฉะนั้นจะถูกหัก {cost}",
  },

  // booking error states (friendly copy keyed off the action failure code)
  err_generic: {
    en: "Something went wrong. Please try again.",
    th: "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง",
  },
  err_no_package: {
    en: "You have no active credits for this class. Buy a package to book.",
    th: "คุณไม่มีเครดิตที่ใช้ได้สำหรับคลาสนี้ กรุณาซื้อแพ็กเกจก่อนจอง",
  },
  err_full: {
    en: "This class just filled up. Try joining the waitlist.",
    th: "คลาสนี้เพิ่งเต็ม ลองเข้าคิวรอแทนได้",
  },
  err_already_booked: {
    en: "You’re already booked into this class.",
    th: "คุณจองคลาสนี้ไว้แล้ว",
  },
  err_not_found: {
    en: "This class is no longer available.",
    th: "คลาสนี้ไม่พร้อมให้บริการแล้ว",
  },
  // NOT_VISIBLE — the class is still in its members-only window for this viewer
  // (a guest before public_visible_at). Surfaced on both book and waitlist-join.
  err_not_visible: {
    en: "This class isn’t open for booking yet. Check back closer to the class time.",
    th: "คลาสนี้ยังไม่เปิดให้จอง กรุณากลับมาอีกครั้งเมื่อใกล้เวลาเรียน",
  },
  err_invalid_position: {
    en: "That reformer position isn’t available. Please choose another.",
    th: "ตำแหน่งเครื่องนี้ใช้ไม่ได้ กรุณาเลือกตำแหน่งอื่น",
  },
  retry: { en: "Try again", th: "ลองใหม่" },

  // join-waitlist error states (keyed off joinWaitlist failure codes)
  err_already_waitlisted: {
    en: "You’re already on the waitlist for this class.",
    th: "คุณอยู่ในคิวรอของคลาสนี้แล้ว",
  },
  // NOT_FULL on join — a seat actually opened up; nudge back to booking.
  err_waitlist_not_full: {
    en: "A spot just opened — try booking instead.",
    th: "เพิ่งมีที่ว่าง ลองจองได้เลย",
  },

  // policy
  policy_body: {
    en: "Free cancellation up to 5 hours before class. Within 5 hours, bookings can’t be cancelled.",
    th: "ยกเลิกได้ฟรีจนถึง 5 ชั่วโมงก่อนคลาส หากเหลือน้อยกว่า 5 ชั่วโมงจะไม่สามารถยกเลิกได้",
  },
  open_hours: { en: "Open daily 8:00–20:00", th: "เปิดทุกวัน 8:00–20:00" },

  // ───────────────────────── customer Profile (lune-extra.jsx ProfileScreen) ─────────────────────────
  // package purchase history list heading
  package_history: { en: "Package history", th: "ประวัติแพ็กเกจ" },
  // household-sharing surface (H1) — who shares the house pool
  shared_with: { en: "Shared with", th: "แบ่งปันกับ" },
  // marks the viewer in the housemates list ("Pim · You")
  you: { en: "You", th: "คุณ" },
  coming_soon: { en: "Coming soon", th: "เร็ว ๆ นี้" },
  // guest (no household) non-sharing state on Profile
  guest_no_household: {
    en: "Guest account — credits are personal and can’t be shared.",
    th: "บัญชีทั่วไป — เครดิตเป็นของคุณคนเดียว แบ่งปันไม่ได้",
  },
  // empty package-history state on Profile
  no_purchases: {
    en: "No packages yet. Buy credits to get started.",
    th: "ยังไม่มีแพ็กเกจ ซื้อเครดิตเพื่อเริ่มต้นได้เลย",
  },

  // bookings list (My Bookings — lune-extra.jsx)
  my_bookings: { en: "My bookings", th: "การจองของฉัน" },
  upcoming: { en: "Upcoming", th: "กำลังจะถึง" },
  past: { en: "Past", th: "ที่ผ่านมา" },
  no_upcoming_bookings: {
    en: "No upcoming classes. Book your next session.",
    th: "ยังไม่มีคลาสที่จะถึง จองคลาสถัดไปของคุณได้เลย",
  },
  no_past_bookings: {
    en: "No past classes yet.",
    th: "ยังไม่มีคลาสที่ผ่านมา",
  },
  cancelled_label: { en: "Cancelled", th: "ยกเลิกแล้ว" },
  completed_label: { en: "Completed", th: "เรียนแล้ว" },

  // waitlist section on My Bookings (CLAUDE.md §5 invariant 6)
  waitlist_section: { en: "Waitlist", th: "คิวรอ" },
  // status pill on a `waiting` entry — interpolates waitlist_position via {pos}.
  waitlisted_status: { en: "Waitlisted · {pos}", th: "อยู่ในคิว · {pos}" },
  spot_opened: { en: "A spot opened!", th: "มีที่ว่างแล้ว!" },
  confirm_spot: { en: "Confirm your spot", th: "ยืนยันที่นั่งของคุณ" },
  // live hold countdown — {time} is the client mm:ss off the server holdExpiresAt.
  offer_expires_in: { en: "Confirm within {time}", th: "ยืนยันภายใน {time}" },
  offer_expired: { en: "Offer expired", th: "หมดเวลายืนยันแล้ว" },
  // brief in-card confirmation after a successful confirmWaitlistOffer.
  waitlist_booked: { en: "Spot confirmed — you’re booked!", th: "ยืนยันที่นั่งแล้ว — จองสำเร็จ!" },

  // confirm-waitlist error states (keyed off confirmWaitlistOffer failure codes)
  err_offer_expired: {
    en: "This offer has expired. We’ll notify you if another spot opens.",
    th: "หมดเวลายืนยันแล้ว หากมีที่ว่างอีกเราจะแจ้งเตือนคุณ",
  },
  err_offer_lost: {
    en: "That spot was just taken. We’ll let you know if another opens.",
    th: "ที่นั่งนั้นเพิ่งถูกจองไป หากมีที่ว่างอีกเราจะแจ้งให้ทราบ",
  },
  err_offer_no_credits: {
    en: "You have no active credits to confirm this spot.",
    th: "คุณไม่มีเครดิตที่ใช้ได้สำหรับยืนยันที่นั่งนี้",
  },

  // cancel (seeded from lune-data.jsx STR). Self-cancel is allowed ONLY ≥5h before
  // class and is then always free/refunded; within 5h it is blocked entirely.
  cancel_class: { en: "Cancel class", th: "ยกเลิกคลาส" },
  cancel_title: { en: "Cancel this class?", th: "ยกเลิกคลาสนี้?" },
  keep_booking: { en: "Keep my booking", th: "เก็บการจองไว้" },
  free_cancel: { en: "Free cancellation", th: "ยกเลิกได้ฟรี" },
  // {cost} is the booking's exact credit cost (e.g. "2 hours"), refunded in full
  // on a free cancel (always, since self-cancel only happens ≥5h before class).
  free_cancel_sub: {
    en: "You’re more than 5 hours before class — your {cost} will be refunded to your balance.",
    th: "เหลือเวลามากกว่า 5 ชั่วโมงก่อนคลาส — {cost} จะถูกคืนเข้าบัญชีของคุณ",
  },
  // "too late" verdict shown when the 5h window has closed (cancel is BLOCKED).
  too_late_to_cancel: { en: "Too late to cancel", th: "เลยกำหนดยกเลิกแล้ว" },
  too_late_sub: {
    en: "It’s within 5 hours of class — this booking can no longer be cancelled.",
    th: "เหลือน้อยกว่า 5 ชั่วโมงก่อนคลาส — ไม่สามารถยกเลิกการจองนี้ได้แล้ว",
  },
  // The booking's free window expressed as a unit phrase (used by the admin drawer
  // and the "You're booked" success policy line).
  window_hours: { en: "{n} hours", th: "{n} ชั่วโมง" },
  window_hour: { en: "{n} hour", th: "{n} ชั่วโมง" },
  cancelled_title: { en: "Booking cancelled", th: "ยกเลิกการจองแล้ว" },
  cancelled_free_sub: {
    en: "Returned {cost} to your balance.",
    th: "คืน {cost} เข้าบัญชีของคุณแล้ว",
  },
  time_until_class: { en: "until class", th: "ก่อนเริ่มคลาส" },

  // cancel error states (keyed off cancelBookingAction failure codes)
  err_cancel_not_found: {
    en: "This booking could not be found. It may already be cancelled.",
    th: "ไม่พบการจองนี้ อาจถูกยกเลิกไปแล้ว",
  },
  err_cancel_not_live: {
    en: "This booking can no longer be cancelled.",
    th: "ไม่สามารถยกเลิกการจองนี้ได้แล้ว",
  },
  err_cancel_too_late: {
    en: "It’s within 5 hours of class — this booking can no longer be cancelled.",
    th: "เหลือเวลาน้อยกว่า 5 ชั่วโมงก่อนคลาส — ไม่สามารถยกเลิกการจองนี้ได้แล้ว",
  },
  // hint on a card whose cancel button is disabled (inside the 5h window).
  too_late_to_cancel_hint: {
    en: "Within 5 hours of class — cancellation is closed.",
    th: "เหลือน้อยกว่า 5 ชั่วโมงก่อนคลาส — ปิดการยกเลิกแล้ว",
  },
  // status-badge label on an upcoming booking past the 5h window (cancel closed).
  too_late_hint: { en: "Cancellation closed", th: "ปิดการยกเลิก" },

  // credits / packages (buy-credits screen) — seeded from lune-data.jsx STR
  packages: { en: "Packages", th: "แพ็กเกจ" },
  choose_package: { en: "Choose a package", th: "เลือกแพ็กเกจที่เหมาะกับคุณ" },
  per_hour: { en: "/hr", th: "/ชม." },
  valid_for: { en: "Valid for", th: "ใช้ได้" },
  one_month: { en: "1 month", th: "1 เดือน" },
  two_months: { en: "2 months", th: "2 เดือน" },
  three_months: { en: "3 months", th: "3 เดือน" },
  single_visit: { en: "Single visit", th: "ครั้งเดียว" },
  best_value: { en: "Best value", th: "คุ้มที่สุด" },
  popular: { en: "Most popular", th: "ยอดนิยม" },
  non_transfer: { en: "Non-transferable", th: "โอนสิทธิ์ไม่ได้" },
  non_transfer_note: {
    en: "Credits are non-transferable (except member household sharing)",
    th: "เครดิตในแพ็กเกจโอนสิทธิ์ไม่ได้ (ยกเว้นการแบ่งปันสำหรับสมาชิก)",
  },
  member_perk_title: {
    en: "Member benefit · Sharable credits",
    th: "สิทธิสมาชิก · แบ่งปันเครดิตได้",
  },
  member_perk_body: {
    en: "Members can share unlimited credits with others at the same house number. Non-member packages cannot be shared.",
    th: "สมาชิกสามารถแบ่งปันเครดิตได้ไม่จำกัดกับผู้ที่อยู่บ้านเลขที่เดียวกัน แพ็กเกจทั่วไปไม่สามารถแบ่งปันได้",
  },
  house_label: { en: "House", th: "บ้านเลขที่" },
  select: { en: "Select", th: "เลือก" },

  // package category tabs (mirror PACKAGE_CATS labels from the catalog contract)
  cat_group: { en: "Group", th: "กลุ่ม" },
  cat_private: { en: "Private", th: "ส่วนตัว" },
  cat_rental: { en: "Rental", th: "เช่าสตูดิโอ" },

  // trial promo (group only)
  trial_title: { en: "Trial · Buy 1 Get 1", th: "ทดลอง · ซื้อ 1 แถม 1" },
  trial_body: {
    en: "First time at LUNE? Your trial class comes with a second session free.",
    th: "มาครั้งแรกที่ LUNE? รับคลาสทดลองฟรีอีกหนึ่งครั้ง",
  },
  trial_cta: { en: "Claim trial offer", th: "รับสิทธิ์ทดลอง" },

  // PromptPay checkout flow
  pay_promptpay: { en: "Pay with PromptPay", th: "ชำระผ่านพร้อมเพย์" },
  scan_to_pay: { en: "Scan to pay", th: "สแกนเพื่อชำระเงิน" },
  scan_hint: {
    en: "Open your banking app and scan this QR code",
    th: "เปิดแอปธนาคารแล้วสแกน QR นี้",
  },
  qr_alt: {
    en: "PromptPay QR code for {amount}, reference {reference}",
    th: "QR พร้อมเพย์สำหรับ {amount} อ้างอิง {reference}",
  },
  amount: { en: "Amount", th: "จำนวนเงิน" },
  download_qr: { en: "Save QR", th: "บันทึก QR" },
  download_qr_aria: {
    en: "Save the PromptPay QR code as an image",
    th: "บันทึกรหัส QR พร้อมเพย์เป็นรูปภาพ",
  },
  ive_paid: { en: "I’ve paid", th: "ชำระเงินแล้ว" },
  payment_done: { en: "Payment received", th: "รับชำระเงินแล้ว" },
  payment_sub: {
    en: "Your credits have been added to your account.",
    th: "เพิ่มเครดิตเข้าบัญชีของคุณเรียบร้อยแล้ว",
  },

  // PromptPay slip upload (Feature 3) — credit is granted only after the front desk
  // verifies the transfer slip, so the customer attaches a slip then waits for review.
  slip_attach: { en: "I’ve transferred — attach slip", th: "โอนแล้ว — แนบสลิป" },
  slip_upload_hint: {
    en: "Attach a screenshot of your transfer slip. We’ll verify it and add your credits.",
    th: "แนบภาพสลิปการโอนเงินของคุณ เราจะตรวจสอบและเพิ่มเครดิตให้",
  },
  slip_choose_image: { en: "Choose slip image", th: "เลือกภาพสลิป" },
  slip_change_image: { en: "Choose a different image", th: "เลือกภาพอื่น" },
  slip_submit: { en: "Submit for verification", th: "ส่งเพื่อตรวจสอบ" },
  slip_submitted_title: { en: "Slip received", th: "ได้รับสลิปแล้ว" },
  slip_submitted_sub: {
    en: "We’ve received your slip — we’ll confirm shortly and add your credits.",
    th: "เราได้รับสลิปของคุณแล้ว จะยืนยันในไม่ช้าและเพิ่มเครดิตให้คุณ",
  },
  // under-review / rejected surfacing on the Buy screen (so a customer can re-upload).
  slip_under_review: {
    en: "Your latest slip is being verified.",
    th: "กำลังตรวจสอบสลิปล่าสุดของคุณ",
  },
  slip_rejected_reupload: {
    en: "Your last slip couldn’t be verified. Tap to upload a new one.",
    th: "ไม่สามารถตรวจสอบสลิปล่าสุดได้ แตะเพื่ออัปโหลดใหม่",
  },
  status_in_review: { en: "In review", th: "กำลังตรวจสอบ" },
  status_rejected: { en: "Rejected", th: "ถูกปฏิเสธ" },
  total: { en: "Total", th: "รวม" },
  expires: { en: "expires", th: "หมดอายุ" },
  new_balance: { en: "New balance", th: "ยอดคงเหลือใหม่" },
  preparing_qr: { en: "Preparing your QR code…", th: "กำลังเตรียม QR ของคุณ…" },
  checkout_title: { en: "Checkout", th: "ชำระเงิน" },

  // checkout error states (keyed off purchase action failure codes)
  err_checkout: {
    en: "We couldn’t start checkout. Please try again.",
    th: "ไม่สามารถเริ่มการชำระเงินได้ กรุณาลองใหม่อีกครั้ง",
  },
  err_not_paid: {
    en: "We haven’t received your payment yet. Once you’ve paid, tap “I’ve paid”.",
    th: "เรายังไม่ได้รับการชำระเงินของคุณ เมื่อชำระแล้วกรุณากด “ชำระเงินแล้ว”",
  },
  err_unknown_package: {
    en: "This package is no longer available. Please choose another.",
    th: "แพ็กเกจนี้ไม่พร้อมให้บริการแล้ว กรุณาเลือกแพ็กเกจอื่น",
  },
  // slip-upload failures (keyed off uploadPaymentSlip failure codes — Feature 3)
  err_invalid_file: {
    en: "That file isn’t a valid image. Please attach a JPG, PNG, or WebP.",
    th: "ไฟล์นี้ไม่ใช่รูปภาพที่ใช้ได้ กรุณาแนบไฟล์ JPG, PNG หรือ WebP",
  },
  err_too_large: {
    en: "That image is too large. Please attach one under 5 MB.",
    th: "รูปภาพนี้ใหญ่เกินไป กรุณาแนบไฟล์ขนาดไม่เกิน 5 MB",
  },
  err_already_paid: {
    en: "This payment has already been confirmed.",
    th: "การชำระเงินนี้ได้รับการยืนยันแล้ว",
  },
  err_forbidden: {
    en: "You can’t upload a slip for this payment.",
    th: "คุณไม่สามารถอัปโหลดสลิปสำหรับการชำระเงินนี้ได้",
  },

  // slip-review outcome screens — after upload the sheet polls confirmPayment until
  // the studio approves (→ credited "paid", reusing payment_done / payment_sub) or
  // rejects (→ this rejected screen, which lets the customer re-upload).
  slip_checking: { en: "Checking for approval…", th: "กำลังรอการอนุมัติ…" },
  slip_rejected_title: { en: "Slip needs another look", th: "สลิปต้องตรวจสอบอีกครั้ง" },
  slip_rejected_sub: {
    en: "Please check your transfer, then upload your slip again.",
    th: "กรุณาตรวจสอบการโอนของคุณ แล้วอัปโหลดสลิปอีกครั้ง",
  },
  slip_reject_reason: { en: "Reason", th: "เหตุผล" },
  slip_upload_again: { en: "Upload again", th: "อัปโหลดใหม่" },

  // ───────────────────────── admin (seeded from admin-data.jsx A) ─────────────────────────
  // admin nav + chrome (own keys so the slightly different Thai from the
  // customer nav — e.g. "ตารางคลาส" vs "ตารางเรียน" — is preserved).
  admin_today: { en: "Today", th: "วันนี้" },
  admin_schedule: { en: "Schedule", th: "ตารางคลาส" },
  admin_bookings: { en: "Bookings", th: "การจอง" },
  admin_members: { en: "Members", th: "สมาชิก" },
  admin_payments: { en: "Payments", th: "การชำระเงิน" },
  admin_instructors: { en: "Instructors", th: "ผู้สอน" },
  admin_label: { en: "Admin", th: "ผู้ดูแล" },
  admin_greeting: { en: "Studio admin", th: "ผู้ดูแลสตูดิโอ" },
  admin_coming_soon: { en: "Coming soon", th: "เร็ว ๆ นี้" },
  admin_more: { en: "More", th: "เพิ่มเติม" },

  // ───────────────────────── admin Business Dashboard (Feature 4) ─────────────────────────
  // Nav + header
  admin_dashboard: { en: "Dashboard", th: "แดชบอร์ด" },
  // 403 fallback when a non-admin reaches an admin-gated page (v1 mock always grants)
  admin_forbidden: { en: "Admins only.", th: "เฉพาะผู้ดูแลระบบเท่านั้น" },
  // Toast when an instructor tries to check in a booking on a class that isn't theirs
  admin_checkin_forbidden: { en: "Not your class.", th: "ไม่ใช่คลาสของคุณ" },
  biz_overview: { en: "Business Overview", th: "ภาพรวมธุรกิจ" },
  as_of: { en: "As of", th: "ณ วันที่" },
  period_mtd: { en: "Month to date", th: "เดือนนี้" },
  period_today: { en: "Today", th: "วันนี้" },
  // §01 Sales & revenue
  sales_revenue: { en: "Sales & revenue", th: "ยอดขาย & รายได้" },
  sales_top_priority: { en: "top priority", th: "ความสำคัญสูงสุด" },
  sales_revenue_mtd: { en: "Month to date · MTD", th: "เดือนนี้ · MTD" },
  vs_last_month: { en: "vs last month", th: "จากเดือนก่อน" },
  vs_yesterday: { en: "vs yesterday", th: "จากเมื่อวาน" },
  daily_revenue_14d: { en: "Daily revenue · last 14 days", th: "รายได้รายวัน · 14 วันล่าสุด" },
  revenue_mix: { en: "Revenue mix · MTD", th: "สัดส่วนรายได้ · เดือนนี้" },
  mix_group: { en: "Group", th: "กลุ่ม" },
  mix_private: { en: "Privates", th: "ส่วนตัว" },
  mix_rental: { en: "Rentals", th: "เช่า" },
  trial_conversion: { en: "Trial conversion", th: "อัตราแปลงทดลอง" },
  b1g1_note: { en: "Buy 1 Get 1 → paying member", th: "ซื้อ 1 แถม 1 → สมาชิกจ่ายเงิน" },
  trial_of: { en: "of", th: "จาก" },
  trials_converted: { en: "trials converted this month", th: "รายที่แปลงเดือนนี้" },
  package_liability: { en: "Package liability", th: "เครดิตคงค้าง" },
  liability_note: { en: "Unredeemed hours on the books", th: "ชั่วโมงที่ยังไม่ใช้คงค้าง" },
  hours_outstanding: { en: "outstanding", th: "คงค้าง" },
  pct_of_sold: { en: "of all sold", th: "ของที่ขายทั้งหมด" },
  revenue_per_instructor: { en: "Revenue per instructor", th: "รายได้ต่อผู้สอน" },
  per_instructor_basis: { en: "MTD · privates, duos & trios", th: "เดือนนี้ · ส่วนตัว ดูโอ ทรีโอ" },
  per_instructor_sub: {
    en: "Income generated by each instructor’s booked sessions",
    th: "รายได้จากคลาสที่ผู้สอนแต่ละคนถูกจอง",
  },
  hrs_taught: { en: "h", th: "ชม." },
  // §02 Capacity & operations
  capacity_ops: { en: "Capacity & daily operations", th: "ความจุ & การดำเนินงาน" },
  class_fill_rate: { en: "Class fill rate", th: "อัตราการเต็มคลาส" },
  avg_group_30d: { en: "Average group-class utilisation · last 30 days", th: "อัตราการใช้คลาสกลุ่มเฉลี่ย · 30 วันล่าสุด" },
  pts: { en: "pts", th: "จุด" },
  fill_group: { en: "Group", th: "กลุ่ม" },
  fill_private: { en: "Private 1:1", th: "ส่วนตัว 1:1" },
  fill_duo: { en: "Duo", th: "ดูโอ" },
  fill_trio: { en: "Trio", th: "ทรีโอ" },
  actionable_alerts: { en: "Actionable alerts", th: "แจ้งเตือนที่ต้องจัดการ" },
  next_24_48h: { en: "Classes in the next 24–48 h that need a decision", th: "คลาสใน 24–48 ชม. ที่ต้องตัดสินใจ" },
  booked_lc: { en: "booked", th: "จอง" },
  on_waitlist_n: { en: "on waitlist", th: "ในคิว" },
  demand_exceeds_supply: { en: "demand exceeds supply", th: "ดีมานด์เกินที่นั่ง" },
  low_enrolment: { en: "low enrolment", th: "ผู้จองน้อย" },
  empty_class: { en: "empty", th: "ว่าง" },
  booked_of: { en: "booked /", th: "จอง /" },
  add_class: { en: "Add class", th: "เพิ่มคลาส" },
  promote: { en: "Promote", th: "โปรโมต" },
  alert_cancel: { en: "Cancel", th: "ยกเลิก" },
  // §03 Retention & CRM
  retention_crm: { en: "Retention & CRM", th: "การรักษาลูกค้า" },
  expiring_7d: { en: "Expiring in the next 7 days", th: "หมดอายุใน 7 วัน" },
  tap_to_nudge: { en: "One tap sends a renewal nudge via LINE OA", th: "แตะเพื่อส่งเตือนต่ออายุผ่าน LINE OA" },
  h_left: { en: "h left", th: "ชม. เหลือ" },
  exp_short: { en: "exp", th: "หมด" },
  send_reminder: { en: "Send reminder", th: "ส่งการเตือน" },
  reminder_sent: { en: "Sent", th: "ส่งแล้ว" },
  remind_all: { en: "Remind all", th: "เตือนทั้งหมด" },
  at_once: { en: "at once", th: "พร้อมกัน" },
  house_usage: { en: "House usage", th: "การใช้แพ็กเกจครอบครัว" },
  shared_burn_rate: { en: "How fast shared family packages are being consumed", th: "อัตราการใช้แพ็กเกจครอบครัวรวม" },
  house_word: { en: "House", th: "บ้าน" },
  illustrative_footnote: {
    en: "Figures are illustrative for layout review. Renewal & alert actions are wired to fire through LINE OA / webhooks in production.",
    th: "ตัวเลขเป็นตัวอย่างสำหรับตรวจเลย์เอาต์ การต่ออายุ & แจ้งเตือนจะทำงานผ่าน LINE OA / webhook ในการใช้งานจริง",
  },

  // shared chrome a11y labels (keyed — no hardcoded aria copy). Used by the admin
  // shell (language group, notifications bell) and the Drawer/Sheet close affordances.
  aria_language: { en: "Language", th: "ภาษา" },
  aria_notifications: { en: "Notifications", th: "การแจ้งเตือน" },
  aria_close: { en: "Close", th: "ปิด" },
  back: { en: "Back", th: "ย้อนกลับ" },

  // admin Today overview
  admin_overview: { en: "Today’s overview", th: "ภาพรวมวันนี้" },
  classes_today: { en: "Classes today", th: "คลาสวันนี้" },
  attendees: { en: "Attendees", th: "ผู้เข้าเรียน" },
  checked_in: { en: "Checked in", th: "เช็คอินแล้ว" },
  on_waitlist: { en: "On waitlist", th: "รอคิว" },
  utilisation: { en: "Utilisation", th: "อัตราการใช้" },
  no_classes_today: { en: "No classes scheduled today", th: "ไม่มีคลาสในวันนี้" },

  // roster drawer
  roster: { en: "Roster", th: "รายชื่อ" },
  check_in: { en: "Check in", th: "เช็คอิน" },
  checked: { en: "Checked", th: "เช็คแล้ว" },
  notify: { en: "Notify", th: "แจ้งเตือน" },
  notified: { en: "Notified", th: "แจ้งแล้ว" },
  guest: { en: "Guest", th: "ทั่วไป" },
  loading: { en: "Loading…", th: "กำลังโหลด…" },
  no_attendees: { en: "No one booked yet", th: "ยังไม่มีผู้จอง" },
  // book-for-a-customer flow (admin Bookings screen)
  book_for_customer: { en: "Book for customer", th: "จองให้ลูกค้า" },
  select_customer: { en: "Select customer", th: "เลือกลูกค้า" },
  select_class: { en: "Select class", th: "เลือกคลาส" },
  search_name_phone: { en: "Search name or phone", th: "ค้นหาชื่อหรือเบอร์" },
  change: { en: "Change", th: "เปลี่ยน" },
  no_results: { en: "No results", th: "ไม่พบผลลัพธ์" },
  booked_for_customer: { en: "Booked for the customer", th: "จองให้ลูกค้าแล้ว" },
  // sales-history detail drawer
  sale_detail: { en: "Sale details", th: "รายละเอียดการขาย" },
  sale_datetime: { en: "Sale date & time", th: "วันที่และเวลาขาย" },
  edit_sale_time: { en: "Correct sale date/time", th: "แก้ไขวันที่/เวลาขาย" },
  sale_time_saved: { en: "Sale time updated", th: "บันทึกเวลาขายใหม่แล้ว" },
  payment_slip: { en: "Payment slip", th: "สลิปการชำระเงิน" },
  no_slip: { en: "No slip uploaded", th: "ยังไม่มีสลิป" },
  keep: { en: "Keep", th: "เก็บไว้" },
  err_position_taken: { en: "That position is taken.", th: "ตำแหน่งนี้ถูกจองแล้ว" },
  booking_cancelled_refunded: { en: "Cancelled · credit refunded", th: "ยกเลิกแล้ว · คืนเครดิต" },
  booking_cancelled_kept: { en: "Cancelled · no refund", th: "ยกเลิกแล้ว · ไม่คืนเครดิต" },

  // admin Schedule management
  edit: { en: "Edit", th: "แก้ไข" },
  new_class: { en: "New class", th: "สร้างคลาส" },
  edit_class: { en: "Edit class", th: "แก้ไขคลาส" },
  class_type: { en: "Class type", th: "ประเภทคลาส" },
  start_time: { en: "Start time", th: "เวลาเริ่ม" },
  instructor_optional: { en: "optional", th: "เลือกได้" },
  no_instructor: { en: "No instructor", th: "ไม่ระบุผู้สอน" },
  save_class: { en: "Save class", th: "บันทึก" },
  delete_class: { en: "Delete class", th: "ลบคลาส" },
  // cancel_class { en:"Cancel class", th:"ยกเลิกคลาส" } already exists in the customer section above.
  cancel_class_confirm: {
    en: "Cancel this class? Everyone booked gets their credit back.",
    th: "ยกเลิกคลาสนี้? ผู้จองทุกคนจะได้รับเครดิตคืน",
  },
  class_cancelled_toast: { en: "Class cancelled · {n} refunded", th: "ยกเลิกคลาสแล้ว · คืนเครดิต {n} คน" },
  people_max_reformers: { en: "people · max 3 reformers", th: "คน · สูงสุด 3 เครื่อง" },
  booked_label: { en: "booked", th: "จองแล้ว" },
  cls_short: { en: "cls", th: "คลาส" },

  // weekday short labels (week strip), Mon..Sun
  dow_mon: { en: "Mon", th: "จ." },
  dow_tue: { en: "Tue", th: "อ." },
  dow_wed: { en: "Wed", th: "พ." },
  dow_thu: { en: "Thu", th: "พฤ." },
  dow_fri: { en: "Fri", th: "ศ." },
  dow_sat: { en: "Sat", th: "ส." },
  dow_sun: { en: "Sun", th: "อา." },

  // schedule status + publish
  status_draft: { en: "Draft", th: "ฉบับร่าง" },
  status_published: { en: "Published", th: "เผยแพร่แล้ว" },
  status_cancelled: { en: "Cancelled", th: "ยกเลิกแล้ว" },
  publish_week: { en: "Publish week", th: "เผยแพร่สัปดาห์" },
  // {n} draft instances not yet visible to anyone.
  n_unpublished: { en: "{n} unpublished", th: "ยังไม่เผยแพร่ {n}" },
  all_published: { en: "All published", th: "เผยแพร่ครบแล้ว" },
  published_toast: { en: "Week published — members notified", th: "เผยแพร่สัปดาห์แล้ว — แจ้งสมาชิกแล้ว" },

  // changes-vs-baseline diff
  changes_vs_baseline: { en: "Changes vs baseline", th: "เทียบกับเทมเพลต" },
  diff_added: { en: "{n} added", th: "เพิ่ม {n}" },
  diff_removed: { en: "{n} cancelled", th: "ยกเลิก {n}" },
  diff_changed: { en: "{n} changed", th: "แก้ไข {n}" },
  matches_baseline: { en: "Matches baseline", th: "ตรงกับเทมเพลต" },

  // load-from-baseline / empty states
  generate_from_baseline: { en: "Load from baseline", th: "โหลดจากเทมเพลต" },
  empty_week_title: { en: "This week is empty", th: "สัปดาห์นี้ยังว่าง" },
  empty_week_sub: {
    en: "Load the recurring baseline to start, then adjust just what changed.",
    th: "โหลดเทมเพลตประจำเพื่อเริ่ม แล้วปรับเฉพาะที่เปลี่ยน",
  },
  no_classes_day: { en: "No classes this day", th: "ไม่มีคลาสในวันนี้" },

  // schedule action errors
  err_capacity_below_booked: {
    en: "Capacity can’t be below the number already booked.",
    th: "ความจุต้องไม่น้อยกว่าจำนวนที่จองแล้ว",
  },
  err_has_bookings: {
    en: "This class has bookings — cancel those first.",
    th: "คลาสนี้มีการจองอยู่ — ยกเลิกการจองก่อน",
  },
  err_invalid_instructor: {
    en: "Please choose a valid instructor.",
    th: "กรุณาเลือกผู้สอนที่ถูกต้อง",
  },
  err_already_cancelled: {
    en: "This class is already cancelled.",
    th: "คลาสนี้ถูกยกเลิกไปแล้ว",
  },

  // ───────────────────────── admin Schedule template editor (recurring weekly template) ─────────────────────────
  // The "Manage template" control sits next to "Load from baseline" on the Schedule
  // screen and opens a Mon→Sun editor of the recurring template slots.
  manage_template: { en: "Manage template", th: "จัดการเทมเพลต" },
  manage_template_title: { en: "Weekly template", th: "เทมเพลตประจำสัปดาห์" },
  manage_template_sub: {
    en: "The recurring weekly classes that “Load from baseline” generates.",
    th: "คลาสประจำสัปดาห์ที่ “โหลดจากเทมเพลต” จะสร้างให้",
  },
  template_slot: { en: "Template slot", th: "ช่วงคลาสในเทมเพลต" },
  add_slot: { en: "Add slot", th: "เพิ่มช่วงคลาส" },
  add_slot_title: { en: "Add template slot", th: "เพิ่มช่วงคลาสในเทมเพลต" },
  edit_slot: { en: "Edit slot", th: "แก้ไขช่วงคลาส" },
  edit_slot_title: { en: "Edit template slot", th: "แก้ไขช่วงคลาสในเทมเพลต" },
  remove_slot: { en: "Remove slot", th: "ลบช่วงคลาส" },
  remove_slot_confirm: {
    en: "Remove this {time} {type} slot from the weekly template?",
    th: "ลบช่วงคลาส {type} เวลา {time} ออกจากเทมเพลตประจำสัปดาห์หรือไม่?",
  },
  slot_day: { en: "Day", th: "วัน" },
  slot_time: { en: "Time", th: "เวลา" },
  slot_type: { en: "Type", th: "ประเภท" },
  slot_duration: { en: "Duration", th: "ระยะเวลา" },
  slot_capacity: { en: "Capacity", th: "จำนวนที่รับ" },
  slot_instructor: { en: "Instructor", th: "ผู้สอน" },
  instructor_any: { en: "Any instructor", th: "ผู้สอนคนใดก็ได้" },
  template_empty_day: { en: "No slots this day", th: "ไม่มีช่วงคลาสในวันนี้" },
  template_empty: {
    en: "No template slots yet — add one to build the recurring week.",
    th: "ยังไม่มีช่วงคลาสในเทมเพลต — เพิ่มเพื่อสร้างสัปดาห์ประจำ",
  },
  toast_template_added: { en: "Template slot added", th: "เพิ่มช่วงคลาสแล้ว" },
  toast_template_updated: { en: "Template slot updated", th: "แก้ไขช่วงคลาสแล้ว" },
  toast_template_removed: { en: "Template slot removed", th: "ลบช่วงคลาสแล้ว" },
  err_template_invalid: {
    en: "Please check the slot details and try again.",
    th: "กรุณาตรวจสอบรายละเอียดช่วงคลาสแล้วลองใหม่",
  },
  err_template_unknown: {
    en: "This template slot no longer exists.",
    th: "ไม่พบช่วงคลาสนี้ในเทมเพลตแล้ว",
  },
  err_template_unknown_instructor: {
    en: "Please choose a valid instructor.",
    th: "กรุณาเลือกผู้สอนที่ถูกต้อง",
  },
  err_template_save: {
    en: "Couldn’t save this slot. Please try again.",
    th: "บันทึกช่วงคลาสไม่สำเร็จ กรุณาลองใหม่",
  },

  // ───────────────────────── admin Bookings & waitlist control (admin-more.jsx) ─────────────────────────
  // tabs + table headers
  all_bookings: { en: "All bookings", th: "การจองทั้งหมด" },
  status: { en: "Status", th: "สถานะ" },
  schedule_col: { en: "Schedule", th: "ตารางคลาส" },
  // booking status labels (mirror admin-data.jsx A.booked / A.confirmed)
  booked: { en: "Booked", th: "จองแล้ว" },
  confirmed: { en: "Confirmed", th: "ยืนยันแล้ว" },
  // waitlist card — live confirm-window badge ("22m confirm window"); {mins} is
  // the whole minutes left on the live offer (server-derived).
  confirm_window: { en: "confirm window", th: "เวลายืนยัน" },
  // empty states for each tab
  no_bookings: { en: "No bookings to show", th: "ไม่มีการจอง" },
  no_waitlist: { en: "No one is waiting on a full class", th: "ไม่มีคิวรอในคลาสที่เต็ม" },

  // booking detail drawer
  booking_detail: { en: "Booking", th: "การจอง" },
  customer: { en: "Customer", th: "ลูกค้า" },
  class_label: { en: "Class", th: "คลาส" },
  credit_cost: { en: "Credit cost", th: "เครดิตที่ใช้" },
  checked_in_label: { en: "Checked in", th: "เช็คอินแล้ว" },
  not_checked_in: { en: "Not checked in", th: "ยังไม่เช็คอิน" },
  cancel_booking: { en: "Cancel booking", th: "ยกเลิกการจอง" },
  // cancel eligibility note in the drawer ({hours} = the booking's free window,
  // {cost} = the credits returned/kept). free → refunds; otherwise kept.
  cancel_free_note: {
    en: "Within the free window — cancelling returns {cost} to the pool.",
    th: "อยู่ในช่วงยกเลิกฟรี — ยกเลิกแล้วคืน {cost} เข้าเครดิตรวม",
  },
  cancel_keep_note: {
    en: "Past the {hours} window — the {cost} credit cost is kept.",
    th: "เลยช่วง {hours} แล้ว — เครดิต {cost} จะถูกหัก",
  },
  // admin refund override toggle (goodwill refund / withhold)
  refund_override: { en: "Refund credits anyway", th: "คืนเครดิตให้แม้เลยกำหนด" },
  refund_override_hint: {
    en: "Override the policy and return the credit cost to the customer.",
    th: "ข้ามนโยบายและคืนเครดิตให้ลูกค้า",
  },

  // admin reschedule (front desk moves a customer's booking to another time; not
  // bound by the 5h customer window — atomic refund-old + debit-new server-side)
  reschedule_booking: { en: "Reschedule", th: "เลื่อนเวลา" },
  resched_admin_title: { en: "Reschedule booking", th: "เลื่อนการจอง" },
  resched_admin_pick: {
    en: "Choose a new time for this customer",
    th: "เลือกเวลาใหม่ให้ลูกค้ารายนี้",
  },
  no_other_times: {
    en: "No other times available for this class type.",
    th: "ไม่มีเวลาอื่นสำหรับคลาสประเภทนี้",
  },
  toast_reschedule_done: {
    en: "Booking rescheduled",
    th: "เลื่อนการจองเรียบร้อยแล้ว",
  },
  toast_reschedule_failed: {
    en: "Couldn’t reschedule this booking. Please try again.",
    th: "เลื่อนการจองไม่สำเร็จ กรุณาลองใหม่",
  },
  // toasts after an action
  toast_cancel_refunded: {
    en: "Booking cancelled — {cost} returned",
    th: "ยกเลิกการจองแล้ว — คืน {cost}",
  },
  toast_cancel_kept: {
    en: "Booking cancelled — credit kept",
    th: "ยกเลิกการจองแล้ว — หักเครดิต",
  },
  toast_cancel_failed: {
    en: "Couldn’t cancel this booking. Please try again.",
    th: "ยกเลิกการจองไม่สำเร็จ กรุณาลองใหม่",
  },
  toast_notified: {
    en: "Notified the next person in the queue",
    th: "แจ้งเตือนคนถัดไปในคิวแล้ว",
  },
  toast_notify_no_head: {
    en: "No one left to notify in this queue",
    th: "ไม่มีคนให้แจ้งเตือนในคิวนี้",
  },
  toast_notify_failed: {
    en: "Couldn’t notify the queue. Please try again.",
    th: "แจ้งเตือนคิวไม่สำเร็จ กรุณาลองใหม่",
  },

  // ───────────────────────── admin Members / Customers & households (admin-more.jsx) ─────────────────────────
  // page header + search
  search_members: { en: "Search members…", th: "ค้นหาสมาชิก…" },
  // PageTitle sub — {n} interpolated with the customer count.
  total_members: { en: "{n} total members", th: "สมาชิกทั้งหมด {n} คน" },
  // table column headers (member/house/sharing reuse existing keys; credits below)
  credits: { en: "Credits", th: "เครดิต" },
  sharing: { en: "Sharing", th: "แบ่งปันเครดิต" },
  active: { en: "Active", th: "ใช้งาน" },
  expiring: { en: "Expiring soon", th: "ใกล้หมดอายุ" },
  // credits cell — "8 hrs", and the expiry sub line "till 24 Jun".
  hrs: { en: "hrs", th: "ชม." },
  expiring_soon: { en: "Expiring soon", th: "ใกล้หมดอายุ" },
  expires_till: { en: "till {date}", th: "ถึง {date}" },
  // detail drawer
  expires_on: { en: "expires {date}", th: "หมดอายุ {date}" },
  in_house: { en: "{n} in house", th: "{n} คนในบ้าน" },
  shared_group: { en: "Shared group", th: "กลุ่มแบ่งปัน" },
  this_member: { en: "This member", th: "คนนี้" },
  share_note_member: {
    en: "Credits are shared without limit across this house number.",
    th: "สมาชิกแบ่งปันเครดิตได้ไม่จำกัดกับคนในบ้านเลขที่เดียวกัน",
  },
  share_note_guest: {
    en: "Guest account — credits are non-transferable and cannot be shared.",
    th: "ลูกค้าทั่วไป — เครดิตโอนหรือแบ่งปันไม่ได้",
  },
  // add-customer form
  add_customer: { en: "Add customer", th: "เพิ่มลูกค้า" },
  customer_name: { en: "Name", th: "ชื่อ" },
  phone_label: { en: "Phone", th: "เบอร์โทร" },
  tier_member: { en: "Member", th: "สมาชิก" },
  tier_guest: { en: "Guest", th: "ทั่วไป" },
  house_number: { en: "House number", th: "บ้านเลขที่" },
  // add-customer placeholders + a11y
  ph_customer_name: { en: "e.g. Pim Srisai", th: "เช่น พิม ศรีใส" },
  ph_phone: { en: "e.g. 081 234 5678", th: "เช่น 081 234 5678" },
  ph_house_number: { en: "e.g. A-114", th: "เช่น A-114" },
  tier_label: { en: "Customer type", th: "ประเภทลูกค้า" },
  save_customer: { en: "Save customer", th: "บันทึกลูกค้า" },
  no_members: { en: "No customers match your search", th: "ไม่พบลูกค้าที่ตรงกับการค้นหา" },
  // toasts / errors
  toast_customer_added: { en: "Customer added", th: "เพิ่มลูกค้าแล้ว" },
  err_phone_taken: {
    en: "That phone number is already registered.",
    th: "เบอร์โทรนี้ถูกใช้ไปแล้ว",
  },
  err_add_customer: {
    en: "Couldn’t add this customer. Please check the details and try again.",
    th: "เพิ่มลูกค้าไม่สำเร็จ กรุณาตรวจสอบข้อมูลแล้วลองใหม่",
  },

  // ───────────────────────── admin customer credit-transaction history (Members drawer) ─────────────────────────
  // section heading below the credits + adjust-credits control
  ledger_title: { en: "Credit transactions", th: "ประวัติเครดิต" },
  // reason labels (mirror lib/admin/members.ts LedgerReason)
  ledger_booking: { en: "Class booking", th: "จองคลาส" },
  ledger_cancel_refund: { en: "Cancellation refund", th: "คืนเครดิตจากการยกเลิก" },
  ledger_purchase: { en: "Package purchase", th: "ซื้อแพ็กเกจ" },
  ledger_adjustment: { en: "Manual adjustment", th: "ปรับด้วยตนเอง" },
  ledger_promo: { en: "Free trial class (1+1)", th: "คลาสทดลองฟรี (1+1)" },
  // running-balance caption + empty state + loading
  ledger_running_balance: { en: "Balance: {n}", th: "คงเหลือ: {n}" },
  ledger_empty: { en: "No transactions yet", th: "ยังไม่มีรายการ" },
  ledger_loading: { en: "Loading transactions…", th: "กำลังโหลดรายการ…" },

  // ───────────────────────── admin Payments & POS (admin-more.jsx PaymentsScreen + admin-mobile-pos.jsx) ─────────────────────────
  // stat tiles
  revenue_mtd: { en: "Revenue · month", th: "รายได้ · เดือนนี้" },
  pkg_sales: { en: "Package sales", th: "ยอดขายแพ็กเกจ" },
  this_month: { en: "this month", th: "เดือนนี้" },
  pending: { en: "Pending", th: "รอชำระ" },
  new_members: { en: "New members", th: "สมาชิกใหม่" },
  // payments table column headers (member/amount/status reuse existing keys)
  pos_method: { en: "Method", th: "วิธีชำระ" },
  // charge status labels (green = paid, amber = pending / in review, rose = rejected)
  paid: { en: "Paid", th: "ชำระแล้ว" },
  // table empty state
  no_payments: { en: "No payments yet", th: "ยังไม่มีการชำระเงิน" },

  // slip verification queue (Feature 3) — admin reviews customer-uploaded slips
  admin_review_queue: { en: "Awaiting verification", th: "รอตรวจสอบ" },
  admin_view_slip: { en: "View slip", th: "ดูสลิป" },
  admin_slip_review_title: { en: "Verify payment slip", th: "ตรวจสอบสลิปการชำระเงิน" },
  admin_approve: { en: "Approve", th: "อนุมัติ" },
  admin_reject: { en: "Reject", th: "ปฏิเสธ" },
  admin_reject_reason: { en: "Reason (optional)", th: "เหตุผล (ไม่บังคับ)" },
  admin_reject_reason_ph: {
    en: "e.g. Amount doesn’t match",
    th: "เช่น ยอดเงินไม่ตรงกัน",
  },
  admin_slip_alt: { en: "Payment slip from {name}", th: "สลิปการชำระเงินจาก {name}" },
  // toasts after an admin review decision
  admin_slip_approved: { en: "Slip approved — credits added", th: "อนุมัติสลิปแล้ว — เพิ่มเครดิตแล้ว" },
  admin_slip_rejected: { en: "Slip rejected", th: "ปฏิเสธสลิปแล้ว" },
  admin_slip_review_failed: {
    en: "Couldn’t complete this review. Please try again.",
    th: "ตรวจสอบไม่สำเร็จ กรุณาลองใหม่",
  },
  admin_slip_loading: { en: "Loading slip…", th: "กำลังโหลดสลิป…" },

  // POS flow
  pos_new_sale: { en: "New sale", th: "ขายใหม่" },
  pos_pick_package: { en: "Pick a package", th: "เลือกแพ็กเกจ" },
  pos_assign_customer: { en: "Assign a customer", th: "เลือกลูกค้า" },
  pos_select_customer: { en: "Select customer", th: "เลือกลูกค้า" },
  pos_method_cash: { en: "Cash", th: "เงินสด" },
  pos_method_promptpay: { en: "PromptPay", th: "พร้อมเพย์" },
  pos_complete_sale: { en: "Complete sale", th: "ยืนยันการขาย" },
  pos_receipt: { en: "Sale complete", th: "ขายสำเร็จ" },
  pos_sale_done: { en: "Done", th: "เสร็จสิ้น" },
  // receipt line: "+{hours} hrs → {name}" (credits added to the chosen customer)
  pos_credited_to: { en: "+{hours} hrs → {name}", th: "+{hours} ชม. → {name}" },

  // POS errors (keyed off the posSellPackage / posConfirmPayment failure codes)
  err_unknown_customer: {
    en: "This customer no longer exists. Please choose another.",
    th: "ไม่พบลูกค้ารายนี้แล้ว กรุณาเลือกใหม่",
  },
  err_pos_sale: {
    en: "Couldn’t complete this sale. Please try again.",
    th: "ทำรายการขายไม่สำเร็จ กรุณาลองใหม่",
  },

  // ───────────────────────── admin Instructors & availability (admin-more.jsx InstructorsScreen + admin-mobile-more.jsx MInstructors / MAvailEditor) ─────────────────────────
  // page header sub (desktop PageTitle sub = A.today_long)
  instr_today_long: { en: "Today’s schedule & availability", th: "ตารางสอน · ตารางว่าง วันนี้" },
  // instructor card subline — "{classes} classes · {attendees} attendees"
  instr_card_sub: { en: "{classes} classes · {attendees} attendees", th: "{classes} คลาส · {attendees} ผู้เข้าเรียน" },
  // availability badges (top-right of the card)
  available: { en: "Available", th: "ว่าง" },
  day_off: { en: "Day off", th: "วันหยุด" },
  // "Today" availability row label + the empty-availability inline note
  avail_today: { en: "Today", th: "วันนี้" },
  // editor entry button + drawer title
  edit_avail: { en: "Edit availability", th: "แก้ไขตารางว่าง" },
  edit_avail_sub: { en: "Weekly availability", th: "ตารางว่างรายสัปดาห์" },
  // editor controls
  add_hours: { en: "Add hours", th: "เพิ่มช่วงเวลา" },
  remove_range: { en: "Remove time range", th: "ลบช่วงเวลา" },
  day_on_off: { en: "Toggle {day}", th: "เปิด/ปิด {day}" },
  save: { en: "Save", th: "บันทึก" },
  // save error states (keyed off setInstructorAvailability failure codes)
  err_avail_save: {
    en: "Couldn’t save availability. Please try again.",
    th: "บันทึกตารางว่างไม่สำเร็จ กรุณาลองใหม่",
  },
  err_unknown_instructor: {
    en: "This instructor no longer exists.",
    th: "ไม่พบผู้สอนรายนี้แล้ว",
  },
  // overlap warning — names the offending day(s); blocks Save until resolved
  err_avail_overlap: {
    en: "Overlapping time ranges on:",
    th: "ช่วงเวลาซ้อนกันใน:",
  },

  // instructor CRUD (add / edit / remove) — Owner-only
  add_instructor: { en: "Add instructor", th: "เพิ่มผู้สอน" },
  edit_instructor: { en: "Edit instructor", th: "แก้ไขผู้สอน" },
  edit_instructor_a11y: { en: "Edit {name}", th: "แก้ไข {name}" },
  add_instructor_title: { en: "Add instructor", th: "เพิ่มผู้สอน" },
  instr_name_en: { en: "Name (English)", th: "ชื่อ (อังกฤษ)" },
  instr_name_th: { en: "Name (Thai)", th: "ชื่อ (ไทย)" },
  instr_tag: { en: "Tag (optional)", th: "ป้ายกำกับ (ไม่บังคับ)" },
  ph_instr_name_en: { en: "e.g. Kru Mai", th: "เช่น Kru Mai" },
  ph_instr_name_th: { en: "e.g. ครูใหม่", th: "เช่น ครูใหม่" },
  ph_instr_tag: { en: "e.g. Reformer specialist", th: "เช่น ผู้เชี่ยวชาญรีฟอร์มเมอร์" },
  save_instructor: { en: "Save instructor", th: "บันทึกผู้สอน" },
  remove_instructor: { en: "Remove", th: "ลบ" },
  remove_instructor_a11y: { en: "Remove {name}", th: "ลบ {name}" },
  remove_instructor_confirm: {
    en: "Remove {name}? Their past classes & availability are kept.",
    th: "ลบ {name} ใช่ไหม คลาสที่ผ่านมาและตารางว่างจะยังถูกเก็บไว้",
  },
  confirm_remove: { en: "Remove", th: "ลบ" },
  // toasts
  toast_instructor_added: { en: "Instructor added", th: "เพิ่มผู้สอนแล้ว" },
  toast_instructor_updated: { en: "Instructor updated", th: "อัปเดตผู้สอนแล้ว" },
  toast_instructor_removed: { en: "Instructor removed", th: "ลบผู้สอนแล้ว" },
  // CRUD errors
  err_instr_id_taken: {
    en: "That name is already taken. Please use a different one.",
    th: "ชื่อนี้ถูกใช้ไปแล้ว กรุณาใช้ชื่ออื่น",
  },
  err_instr_invalid: {
    en: "Please check the details and try again.",
    th: "กรุณาตรวจสอบข้อมูลแล้วลองใหม่",
  },
  err_instr_save: {
    en: "Couldn’t save this instructor. Please try again.",
    th: "บันทึกผู้สอนไม่สำเร็จ กรุณาลองใหม่",
  },
  err_instr_remove: {
    en: "Couldn’t remove this instructor. Please try again.",
    th: "ลบผู้สอนไม่สำเร็จ กรุณาลองใหม่",
  },

  // full weekday names for the availability editor (EN short Mon..Sun; TH from DAYS_TH)
  day_mon: { en: "Mon", th: "จันทร์" },
  day_tue: { en: "Tue", th: "อังคาร" },
  day_wed: { en: "Wed", th: "พุธ" },
  day_thu: { en: "Thu", th: "พฤหัส" },
  day_fri: { en: "Fri", th: "ศุกร์" },
  day_sat: { en: "Sat", th: "เสาร์" },
  day_sun: { en: "Sun", th: "อาทิตย์" },

  // ───────────────────────── admin Sales history & CSV export (Group D #1, Owner-only) ─────────────────────────
  admin_sales: { en: "Sales", th: "ยอดขาย" },
  sales_history: { en: "Sales history", th: "ประวัติการขาย" },
  sales_range_from: { en: "From", th: "ตั้งแต่" },
  sales_range_to: { en: "To", th: "ถึง" },
  sales_download_csv: { en: "Download CSV", th: "ดาวน์โหลด CSV" },
  sales_col_customer: { en: "Customer", th: "ลูกค้า" },
  sales_col_package: { en: "Package", th: "แพ็กเกจ" },
  sales_col_method: { en: "Method", th: "วิธีชำระ" },
  sales_col_amount: { en: "Amount", th: "จำนวนเงิน" },
  sales_col_status: { en: "Status", th: "สถานะ" },
  sales_empty: {
    en: "No sales in this date range",
    th: "ไม่มีการขายในช่วงวันที่นี้",
  },
  // quick-pick range presets
  range_today: { en: "Today", th: "วันนี้" },
  range_week: { en: "This week", th: "สัปดาห์นี้" },
  range_month: { en: "This month", th: "เดือนนี้" },
  range_year: { en: "This year", th: "ปีนี้" },

  // ───────────────────────── admin Adjust credits (Group D #8, Owner-only, in the Members drawer) ─────────────────────────
  adjust_credits: { en: "Adjust credits", th: "ปรับเครดิต" },
  adjust_amount: { en: "Amount (hrs)", th: "จำนวน (ชม.)" },
  adjust_add: { en: "Add", th: "เพิ่ม" },
  adjust_subtract: { en: "Subtract", th: "ลด" },
  adjust_note: { en: "Note", th: "หมายเหตุ" },
  adjust_confirm: { en: "Apply adjustment", th: "ยืนยันการปรับ" },
  adjust_select_package: { en: "Package", th: "แพ็กเกจ" },
  adjust_no_packages: {
    en: "This customer has no adjustable packages.",
    th: "ลูกค้ารายนี้ไม่มีแพ็กเกจที่ปรับได้",
  },
  adjust_note_ph: {
    en: "e.g. Goodwill credit for a cancelled class",
    th: "เช่น เครดิตชดเชยจากคลาสที่ยกเลิก",
  },
  toast_credit_adjusted: { en: "Credits adjusted", th: "ปรับเครดิตแล้ว" },
  err_negative_balance: {
    en: "That would take the balance below zero.",
    th: "การปรับนี้จะทำให้ยอดเครดิตติดลบ",
  },
  err_adjust_credits: {
    en: "Couldn’t adjust credits. Please try again.",
    th: "ปรับเครดิตไม่สำเร็จ กรุณาลองใหม่",
  },
} as const;

export type StrKey = keyof typeof STR;
