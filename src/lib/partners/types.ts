/**
 * Cross-partner type contracts.
 *
 * Every external service (AePS, DMT, BBPS, recharge, travel, SMS, email,
 * PAN) implements one of these interfaces. The app layer never imports a
 * vendor SDK directly — it goes through `getPartner(vertical)` so we can
 * swap PaySprint→Eko or MSG91→Twilio without touching business logic.
 */

export type Money = number; // paise? rupees? — we use rupees with 2-decimal Decimal in DB

export type PartnerResult<T> =
  | { ok: true; data: T; partnerTxnId?: string; raw?: unknown; pending?: boolean }
  | { ok: false; code: string; message: string; raw?: unknown };

export interface IdempotencyContext {
  /** Caller-generated idempotency key, persisted with the Transaction row. */
  idempotencyKey: string;
  userId: string;
  ip?: string;
  device?: string;
}

// ---------- AePS ----------
export interface AepsBalanceInput extends IdempotencyContext {
  aadhaar: string;
  bankIin: string;
  biometric: { type: "FMR" | "FIR"; data: string }; // base64 PID block
}
export interface AepsBalanceOutput {
  balance: Money;
  txnReference: string;
}
export interface AepsWithdrawInput extends AepsBalanceInput {
  amount: Money;
}
export interface AepsWithdrawOutput {
  amountDispensed: Money;
  bankRRN: string;
  txnReference: string;
}
export interface AepsProvider {
  name: string;
  balance(input: AepsBalanceInput): Promise<PartnerResult<AepsBalanceOutput>>;
  withdraw(input: AepsWithdrawInput): Promise<PartnerResult<AepsWithdrawOutput>>;
  miniStatement(input: AepsBalanceInput): Promise<PartnerResult<{ entries: Array<{ date: string; amount: Money; type: "CR" | "DR"; narration: string }> }>>;
}

// ---------- DMT ----------
export interface DmtTransferInput extends IdempotencyContext {
  mode: "IMPS" | "NEFT" | "RTGS";
  beneficiary: { name: string; accountNumber: string; ifsc: string; mobile?: string };
  amount: Money;
  remitterMobile: string;
  purpose?: string;
}
export interface DmtTransferOutput {
  bankRRN: string;
  txnReference: string;
  charged: Money;
}
export interface DmtProvider {
  name: string;
  verifyBeneficiary(input: { ifsc: string; accountNumber: string }): Promise<PartnerResult<{ name: string; verified: boolean }>>;
  transfer(input: DmtTransferInput): Promise<PartnerResult<DmtTransferOutput>>;
}

// ---------- UPI Collect (PG) ----------
export interface UpiCollectInput extends IdempotencyContext {
  amount: Money;
  vpa?: string; // payer VPA (optional for QR)
  note?: string;
  customerEmail?: string;
  customerPhone: string;
  callbackUrl: string;
}
export interface UpiCollectOutput {
  orderId: string;
  paymentUrl?: string; // hosted page or upi:// deep link
  upiIntent?: string;
  qrSvg?: string;
}
export interface UpiProvider {
  name: string;
  collect(input: UpiCollectInput): Promise<PartnerResult<UpiCollectOutput>>;
  status(orderId: string): Promise<PartnerResult<{ status: "CREATED" | "PAID" | "FAILED" | "EXPIRED"; paidAt?: string }>>;
}

// ---------- Payouts ----------
export interface PayoutInput extends IdempotencyContext {
  mode: "IMPS" | "NEFT" | "RTGS" | "UPI";
  amount: Money;
  beneficiary: { name: string; accountNumber?: string; ifsc?: string; vpa?: string };
  purpose: string;
}
export interface PayoutOutput {
  payoutId: string;
  utr?: string;
  status: "PROCESSING" | "PAID" | "FAILED";
}
export interface PayoutProvider {
  name: string;
  payout(input: PayoutInput): Promise<PartnerResult<PayoutOutput>>;
  /**
   * Poll the terminal state of a payout. Accepts the provider txn id when
   * known, otherwise our reference_id (providers like BulkPe support lookup by
   * either), so the reconciler can recover even if the initiate call's id was
   * never persisted.
   */
  status(payoutIdOrReference: string): Promise<PartnerResult<{ status: PayoutOutput["status"]; utr?: string }>>;
  /**
   * Optional: fetch the provider's current wallet/float balance (rupees).
   * Used to surface live "Vendor Balances" on the admin dashboard. Best-effort
   * — callers must tolerate this being absent or failing.
   */
  fetchBalance?(): Promise<PartnerResult<number>>;
}

// ---------- BBPS ----------
export interface BbpsFetchInput extends IdempotencyContext {
  billerCode: string;
  category: "ELECTRICITY" | "WATER" | "GAS" | "CREDIT_CARD" | "EDUCATION" | "INSURANCE" | "BROADBAND";
  customerParams: Record<string, string>;
}
export interface BbpsBill {
  customerName: string;
  amount: Money;
  dueDate?: string;
  billNumber?: string;
  billDate?: string;
  /** Minimum payable amount, when the biller reports one (credit cards). */
  minAmount?: Money;
  /** Maximum permissible amount, when the biller reports one. */
  maxAmount?: Money;
  /**
   * Provider reference for this fetch. Providers that require it (Same Day
   * Pay2New) will reject a pay() whose customerParams lack `billFetchRef`.
   */
  billFetchRef?: string;
}
export interface BbpsPayInput extends BbpsFetchInput {
  amount: Money;
  /** Optional remark/narration sent to the provider (best-effort). */
  remark?: string;
}
export interface BbpsPayOutput {
  txnReference: string;
  receipt: string;
}
export interface BbpsBiller {
  code: string;
  name: string;
  category: BbpsFetchInput["category"];
  /**
   * Optional: the customer input fields this biller requires (BulkPe exposes
   * these via selectBiller). UIs use them to render dynamic fetch-bill forms;
   * absent for providers that don't publish param metadata.
   */
  params?: Array<{ name: string; dataType: string; optional: boolean }>;
}
export interface BbpsProvider {
  name: string;
  fetchBill(input: BbpsFetchInput): Promise<PartnerResult<BbpsBill>>;
  pay(input: BbpsPayInput): Promise<PartnerResult<BbpsPayOutput>>;
  /** Optional: live biller catalog for a category (Same Day exposes CC billers). */
  billers?(category: BbpsFetchInput["category"]): Promise<PartnerResult<BbpsBiller[]>>;
  /**
   * Optional: poll a payment's terminal state by provider order id or request
   * id — used after timeouts (never blind-retry pay) and by reconciliation.
   */
  status?(ref: { orderId?: string; requestId?: string }): Promise<
    PartnerResult<{ status: "SUCCESS" | "PENDING" | "FAILED" | "REFUNDED"; operatorRef?: string }>
  >;
}

// ---------- Recharge / DTH / Broadband ----------
export interface RechargeInput extends IdempotencyContext {
  type: "MOBILE" | "DTH" | "BROADBAND";
  operatorCode: string;
  number: string; // mobile / subscriber id / customer id
  amount: Money;
  circle?: string;
}
export interface RechargeOutput {
  operatorRef: string;
  txnReference: string;
}
export interface RechargeProvider {
  name: string;
  recharge(input: RechargeInput): Promise<PartnerResult<RechargeOutput>>;
  plans(input: { type: RechargeInput["type"]; operatorCode: string; circle?: string }): Promise<PartnerResult<Array<{ amount: Money; validity: string; description: string }>>>;
  status(txnReference: string): Promise<PartnerResult<{ status: "SUCCESS" | "PENDING" | "FAILED" }>>;
}

// ---------- Travel ----------
export interface FlightSearchInput {
  from: string; // IATA
  to: string;
  date: string; // YYYY-MM-DD
  returnDate?: string;
  adults: number;
  children?: number;
  infants?: number;
  cabinClass?: "ECONOMY" | "PREMIUM_ECONOMY" | "BUSINESS" | "FIRST";
}
export interface FlightOption {
  id: string;
  airline: string;
  flightNumber: string;
  depart: string; // ISO
  arrive: string;
  durationMin: number;
  price: Money;
  fareKey: string; // pass through to book
}
export interface HotelSearchInput {
  city: string;
  checkIn: string;
  checkOut: string;
  guests: number;
  rooms?: number;
}
export interface HotelOption {
  id: string;
  name: string;
  rating: number;
  pricePerNight: Money;
  imageUrl?: string;
  roomKey: string;
}
export interface BusSearchInput {
  from: string;
  to: string;
  date: string;
}
export interface BusOption {
  id: string;
  operator: string;
  type: string;
  depart: string;
  arrive: string;
  price: Money;
  seatKey: string;
}
export interface TravelBookInput extends IdempotencyContext {
  kind: "FLIGHT" | "HOTEL" | "BUS";
  reference: string; // fareKey | roomKey | seatKey
  passengers: Array<{ name: string; dob?: string; gender?: "M" | "F"; phone?: string; email?: string }>;
  contact: { phone: string; email: string };
}
export interface TravelBookOutput {
  pnr: string;
  ticketUrl?: string;
}
export interface TravelProvider {
  name: string;
  searchFlights(input: FlightSearchInput): Promise<PartnerResult<FlightOption[]>>;
  searchHotels(input: HotelSearchInput): Promise<PartnerResult<HotelOption[]>>;
  searchBuses(input: BusSearchInput): Promise<PartnerResult<BusOption[]>>;
  book(input: TravelBookInput): Promise<PartnerResult<TravelBookOutput>>;
}

// ---------- PAN ----------
export interface PanApplyInput extends IdempotencyContext {
  applicantName: string;
  fatherName: string;
  dob: string;
  gender: "M" | "F";
  email: string;
  phone: string;
  addressLine: string;
  city: string;
  state: string;
  pincode: string;
  aadhaarRef: string; // hashed
  category: "INDIVIDUAL" | "HUF" | "FIRM";
}
export interface PanApplyOutput {
  ackNumber: string;
  trackingUrl?: string;
}
export interface PanProvider {
  name: string;
  apply(input: PanApplyInput): Promise<PartnerResult<PanApplyOutput>>;
  status(ack: string): Promise<PartnerResult<{ status: string; pan?: string }>>;
}

// ---------- SMS / OTP ----------
export interface SmsProvider {
  name: string;
  sendOtp(input: { phone: string; otp: string; templateId?: string }): Promise<PartnerResult<{ messageId: string }>>;
  sendTransactional(input: { phone: string; templateId: string; variables: Record<string, string> }): Promise<PartnerResult<{ messageId: string }>>;
}

// ---------- Managed OTP (Twilio Verify) ----------
export interface OtpVerifyProvider {
  name: string;
  sendVerification(input: { to: string; channel: "sms" | "email" | "whatsapp" }): Promise<PartnerResult<{ sid: string; status: string }>>;
  checkVerification(input: { to: string; code: string }): Promise<PartnerResult<{ sid: string; status: string; valid: boolean }>>;
}

// ---------- Email ----------
export interface EmailProvider {
  name: string;
  send(input: { to: string | string[]; subject: string; html: string; text?: string; from?: string }): Promise<PartnerResult<{ messageId: string }>>;
}
