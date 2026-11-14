import { CreditCard } from "lucide-react";
import { ServicePageHeader } from "@/components/dashboard/ServicePage";
import { ChagansCCBillForm } from "@/components/dashboard/ChagansCCBillForm";

export const dynamic = "force-dynamic";

export default function ChagansCCBillPayPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <ServicePageHeader
        icon={CreditCard}
        title="CC Bill Payment"
        description="Pay credit card bills via BBPS — select your card issuer, verify your bill, and pay securely from your wallet."
      />
      <ChagansCCBillForm apiBase="/api/services/chagans-cc" />
    </div>
  );
}
