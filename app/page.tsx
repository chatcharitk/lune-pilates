import { redirect } from "next/navigation";

// Root → the customer app. The customer surface lives under /home (LINE LIFF
// entry); the admin app is at /admin. Sending `/` straight to /home keeps the
// public root the customer experience (no admin link exposed here).
export default function Index() {
  redirect("/home");
}
