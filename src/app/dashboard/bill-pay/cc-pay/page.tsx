import { CreditCard } from "lucide-react";
import { ServicePageHeader } from "@/components/dashboard/ServicePage";
import { RechargekitCCForm } from "@/components/dashboard/RechargekitCCForm";

export const dynamic = "force-dynamic";

export default function RechargekitCCPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <ServicePageHeader
        icon={CreditCard}
        title="Credit Card Bill Payment-2"
        description="Pay credit card bills directly — enter the full card number, bank details, and amount. Charges are shown before confirmation."
      />
      <RechargekitCCForm />
    </div>
  );
}
