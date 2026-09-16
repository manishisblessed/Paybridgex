import type { Prisma, PosBookingStatus } from "@prisma/client";
import { toNumber } from "@/lib/money";

/**
 * POS machine booking domain helpers.
 *
 * A booking is the retailer-facing, self-service front door to a POS rental:
 * the applicant picks a plan, confirms a delivery address and pays the upfront
 * charge from their wallet. Ops then drives the fulfilment lifecycle from the
 * admin console. This module owns the shared status metadata (so the retailer
 * timeline and the admin queue label things identically) and the serialization
 * from Prisma rows into the JSON the UIs consume.
 */

/** Ordered fulfilment lifecycle used to render the applicant's status stepper. */
export const BOOKING_STEPS: {
  status: PosBookingStatus;
  label: string;
  description: string;
}[] = [
  { status: "APPLIED", label: "Applied & Paid", description: "Your rental request is placed and the charge is paid." },
  { status: "ASSIGNED", label: "Machine Assigned", description: "A POS machine has been allocated to you." },
  { status: "DISPATCHED", label: "Dispatched", description: "Your machine is on the way." },
  { status: "DELIVERED", label: "Delivered", description: "Machine delivered — you're live!" },
];

/** Index of a status within the linear stepper (CANCELLED is off-track = -1). */
export function bookingStepIndex(status: PosBookingStatus): number {
  return BOOKING_STEPS.findIndex((s) => s.status === status);
}

/** Human labels for every status (incl. the off-track CANCELLED terminal). */
export const BOOKING_STATUS_LABEL: Record<PosBookingStatus, string> = {
  APPLIED: "Applied & Paid",
  ASSIGNED: "Machine Assigned",
  DISPATCHED: "Dispatched",
  DELIVERED: "Delivered",
  CANCELLED: "Cancelled",
};

/** Prisma select that captures everything the UIs need for a booking row. */
export const bookingSelect = {
  id: true,
  status: true,
  deliveryAddress: true,
  contactName: true,
  contactPhone: true,
  monthlyRent: true,
  includeGst: true,
  gstAmount: true,
  setupFee: true,
  deposit: true,
  amountPaid: true,
  billingDay: true,
  courier: true,
  trackingRef: true,
  assignedAt: true,
  dispatchedAt: true,
  deliveredAt: true,
  cancelledAt: true,
  cancelReason: true,
  createdAt: true,
  updatedAt: true,
  subscriptionId: true,
  plan: { select: { id: true, name: true, description: true } },
  machine: { select: { id: true, tid: true, serial: true, model: true, provider: true, status: true } },
  user: { select: { id: true, name: true, email: true, phone: true, role: true, userCode: true, shopName: true } },
  events: {
    select: { id: true, status: true, note: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  },
} satisfies Prisma.PosBookingRequestSelect;

type BookingRow = Prisma.PosBookingRequestGetPayload<{ select: typeof bookingSelect }>;

export type SerializedBooking = {
  id: string;
  status: PosBookingStatus;
  statusLabel: string;
  stepIndex: number;
  deliveryAddress: string;
  contactName: string | null;
  contactPhone: string | null;
  monthlyRent: number;
  includeGst: boolean;
  gstAmount: number;
  setupFee: number;
  deposit: number;
  amountPaid: number;
  billingDay: number;
  courier: string | null;
  trackingRef: string | null;
  assignedAt: string | null;
  dispatchedAt: string | null;
  deliveredAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  createdAt: string;
  updatedAt: string;
  subscriptionId: string | null;
  plan: { id: string; name: string; description: string | null };
  machine: {
    id: string;
    tid: string | null;
    serial: string | null;
    model: string | null;
    provider: string;
    status: string;
  } | null;
  user: {
    id: string;
    name: string;
    email: string;
    phone: string;
    role: string;
    userCode: string | null;
    shopName: string | null;
  };
  events: { id: string; status: PosBookingStatus; note: string | null; createdAt: string }[];
};

/** Serialize a booking row (with `bookingSelect`) into the API/UI shape. */
export function serializeBooking(row: BookingRow): SerializedBooking {
  return {
    id: row.id,
    status: row.status,
    statusLabel: BOOKING_STATUS_LABEL[row.status],
    stepIndex: bookingStepIndex(row.status),
    deliveryAddress: row.deliveryAddress,
    contactName: row.contactName,
    contactPhone: row.contactPhone,
    monthlyRent: toNumber(row.monthlyRent),
    includeGst: row.includeGst,
    gstAmount: toNumber(row.gstAmount),
    setupFee: toNumber(row.setupFee),
    deposit: toNumber(row.deposit),
    amountPaid: toNumber(row.amountPaid),
    billingDay: row.billingDay,
    courier: row.courier,
    trackingRef: row.trackingRef,
    assignedAt: row.assignedAt ? row.assignedAt.toISOString() : null,
    dispatchedAt: row.dispatchedAt ? row.dispatchedAt.toISOString() : null,
    deliveredAt: row.deliveredAt ? row.deliveredAt.toISOString() : null,
    cancelledAt: row.cancelledAt ? row.cancelledAt.toISOString() : null,
    cancelReason: row.cancelReason,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    subscriptionId: row.subscriptionId,
    plan: row.plan,
    machine: row.machine,
    user: row.user,
    events: row.events.map((e) => ({
      id: e.id,
      status: e.status,
      note: e.note,
      createdAt: e.createdAt.toISOString(),
    })),
  };
}
