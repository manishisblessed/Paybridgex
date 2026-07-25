import { redirect } from "next/navigation";

/**
 * Company Charges was merged into Brands & MDR (Company charges tab). This
 * route now redirects so old links / bookmarks don't 404.
 */
export default function CompanyChargesRedirect() {
  redirect("/dashboard/admin/brands");
}
