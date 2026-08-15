import { BridgeHero } from "@/components/home/BridgeHero";
import { HowItWorks } from "@/components/home/HowItWorks";
import { ServicesBento } from "@/components/home/ServicesBento";
import { WhyPaybridgex } from "@/components/home/WhyPaybridgex";
import { RolesStrip } from "@/components/home/RolesStrip";
import { ComplianceBand } from "@/components/home/ComplianceBand";
import { Pricing } from "@/components/home/Pricing";
import { TestimonialWall } from "@/components/home/TestimonialWall";
import { Faq } from "@/components/home/Faq";
import { FinalCTA } from "@/components/home/FinalCTA";

export default function HomePage() {
  return (
    <>
      <BridgeHero />
      <HowItWorks />
      <ServicesBento />
      <WhyPaybridgex />
      <RolesStrip />
      <ComplianceBand />
      <Pricing />
      <TestimonialWall />
      <Faq />
      <FinalCTA />
    </>
  );
}
