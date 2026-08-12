import { CreditCard } from "lucide-react";
import { ServicePageHeader } from "@/components/dashboard/ServicePage";
import { CreditCardBillForm } from "@/components/dashboard/CreditCardBillForm";
import { SERVICE_KEYS } from "@/lib/services/catalog";

export const dynamic = "force-dynamic";

export default function CreditCardBillPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <ServicePageHeader
        icon={CreditCard}
        title="Credit Card Bill Payment"
        description="Pay credit card bills across all major banks via Same Day BBPS — fetch the live bill with the card's last 4 digits and registered mobile."
      />
      <CreditCardBillForm route={SERVICE_KEYS.BBPS_CREDIT_CARD} />
    </div>
  );
}
