/**
 * Safe in-memory MOCK providers. Used when the corresponding partner
 * `PARTNER_*_ENABLED` flag is "false". They mimic realistic latency and
 * occasionally fail so the UI / state machines exercise both happy and
 * sad paths.
 */
import { nanoid } from "nanoid";
import type {
  AepsProvider,
  BbpsProvider,
  DmtProvider,
  EmailProvider,
  PanProvider,
  PartnerResult,
  PayoutProvider,
  RechargeProvider,
  SmsProvider,
  TravelProvider,
  UpiProvider
} from "./types";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ref = (p: string) => `${p}-${nanoid(10).toUpperCase()}`;

function ok<T>(data: T, partnerTxnId?: string): PartnerResult<T> {
  return { ok: true, data, partnerTxnId };
}

export const mockAeps: AepsProvider = {
  name: "MOCK-AePS",
  async balance(input) {
    await sleep(700);
    return ok({ balance: 18420.5, txnReference: ref("AEPS_BAL") }, ref("RRN"));
  },
  async withdraw(input) {
    await sleep(900);
    return ok({ amountDispensed: input.amount, bankRRN: ref("RRN"), txnReference: ref("AEPS_WD") }, ref("RRN"));
  },
  async miniStatement() {
    await sleep(700);
    return ok({
      entries: [
        { date: "2026-04-18", amount: 5000, type: "CR", narration: "NEFT IN" },
        { date: "2026-04-17", amount: 1200, type: "DR", narration: "ATM WDL" },
        { date: "2026-04-15", amount: 2800, type: "CR", narration: "UPI" }
      ]
    });
  }
};

export const mockDmt: DmtProvider = {
  name: "MOCK-DMT",
  async verifyBeneficiary(input) {
    await sleep(500);
    return ok({ name: "Mock Beneficiary", verified: true });
  },
  async transfer(input) {
    await sleep(1000);
    const fee = input.mode === "RTGS" ? 12 : input.mode === "NEFT" ? 6 : 5;
    return ok({ bankRRN: ref("RRN"), txnReference: ref("DMT"), charged: input.amount + fee }, ref("RRN"));
  }
};

export const mockUpi: UpiProvider = {
  name: "MOCK-UPI",
  async collect(input) {
    await sleep(400);
    const orderId = ref("ORDR");
    return ok({
      orderId,
      upiIntent: `upi://pay?pa=paybridgex@axisbank&pn=Paybridgex&am=${input.amount}&tn=${encodeURIComponent(input.note ?? "Paybridgex")}`,
      paymentUrl: `${process.env.NEXT_PUBLIC_APP_URL}/pay/${orderId}`
    });
  },
  async status() {
    await sleep(300);
    return ok({ status: "PAID", paidAt: new Date().toISOString() });
  }
};

export const mockPayout: PayoutProvider = {
  name: "MOCK-PAYOUT",
  async payout(input) {
    await sleep(800);
    return ok({ payoutId: ref("PYT"), utr: ref("UTR"), status: "PROCESSING" });
  },
  async status() {
    await sleep(300);
    return ok({ status: "PAID", utr: ref("UTR") });
  }
};

export const mockBbps: BbpsProvider = {
  name: "MOCK-BBPS",
  async fetchBill(input) {
    await sleep(700);
    return ok({
      customerName: "Mock Customer",
      amount: 1840,
      dueDate: "2026-05-05",
      billNumber: ref("BIL"),
      billDate: new Date().toISOString()
    });
  },
  async pay(input) {
    await sleep(1100);
    return ok({ txnReference: ref("BBPS"), receipt: ref("RCPT") }, ref("BBPS"));
  }
};

export const mockRecharge: RechargeProvider = {
  name: "MOCK-RECHARGE",
  async recharge(input) {
    await sleep(900);
    return ok({ operatorRef: ref("OP"), txnReference: ref("RCH") }, ref("OP"));
  },
  async plans() {
    await sleep(300);
    return ok([
      { amount: 149, validity: "28 days", description: "1 GB/day · Unlimited calls" },
      { amount: 299, validity: "84 days", description: "2 GB/day · Unlimited calls" },
      { amount: 666, validity: "84 days", description: "1.5 GB/day · 100 SMS" },
      { amount: 999, validity: "365 days", description: "24 GB total" }
    ]);
  },
  async status() {
    await sleep(200);
    return ok({ status: "SUCCESS" });
  }
};

export const mockTravel: TravelProvider = {
  name: "MOCK-TRAVEL",
  async searchFlights(input) {
    await sleep(900);
    return ok([
      { id: "F1", airline: "IndiGo", flightNumber: "6E-2031", depart: `${input.date}T06:10:00`, arrive: `${input.date}T08:25:00`, durationMin: 135, price: 4790, fareKey: ref("FK") },
      { id: "F2", airline: "Vistara", flightNumber: "UK-885",  depart: `${input.date}T07:35:00`, arrive: `${input.date}T09:45:00`, durationMin: 130, price: 5340, fareKey: ref("FK") },
      { id: "F3", airline: "Air India", flightNumber: "AI-440", depart: `${input.date}T11:50:00`, arrive: `${input.date}T14:05:00`, durationMin: 135, price: 5120, fareKey: ref("FK") }
    ]);
  },
  async searchHotels(input) {
    await sleep(800);
    return ok([
      { id: "H1", name: "Taj Mahal Palace", rating: 4.9, pricePerNight: 18900, roomKey: ref("RK") },
      { id: "H2", name: "ITC Grand Bharat", rating: 4.8, pricePerNight: 21500, roomKey: ref("RK") }
    ]);
  },
  async searchBuses(input) {
    await sleep(700);
    return ok([
      { id: "B1", operator: "VRL Travels", type: "AC Sleeper", depart: `${input.date}T21:30`, arrive: `${input.date}T07:15`, price: 1199, seatKey: ref("SK") },
      { id: "B2", operator: "Orange",      type: "AC Seater",  depart: `${input.date}T22:00`, arrive: `${input.date}T08:45`, price: 799,  seatKey: ref("SK") }
    ]);
  },
  async book(input) {
    await sleep(1200);
    return ok({ pnr: ref("PNR"), ticketUrl: `${process.env.NEXT_PUBLIC_APP_URL}/tickets/${ref("T")}.pdf` }, ref("PNR"));
  }
};

export const mockPan: PanProvider = {
  name: "MOCK-PAN",
  async apply(input) {
    await sleep(800);
    return ok({ ackNumber: ref("ACK"), trackingUrl: "https://tin.tin.nsdl.com/pantan/StatusTrack.html" });
  },
  async status(ack) {
    await sleep(300);
    return ok({ status: "Under processing" });
  }
};

export const mockSms: SmsProvider = {
  name: "MOCK-SMS",
  async sendOtp(input) {
    console.info(`[mock-sms] OTP ${input.otp} → ${input.phone}`);
    await sleep(150);
    return ok({ messageId: ref("MSG") });
  },
  async sendTransactional(input) {
    console.info(`[mock-sms] tx → ${input.phone}`, input.variables);
    await sleep(150);
    return ok({ messageId: ref("MSG") });
  }
};

export const mockEmail: EmailProvider = {
  name: "MOCK-EMAIL",
  async send(input) {
    console.info(`[mock-email] → ${input.to} :: ${input.subject}`);
    await sleep(200);
    return ok({ messageId: ref("EM") });
  }
};
