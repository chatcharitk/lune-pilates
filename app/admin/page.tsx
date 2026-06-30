import { redirect } from "next/navigation";

// /admin → the admin home. There is no admin index screen; Today is the natural
// front-desk landing and is reachable by both Owner and Instructor roles. So the
// bare /admin link lands somewhere useful instead of 404ing.
export default function AdminIndex() {
  redirect("/admin/today");
}
