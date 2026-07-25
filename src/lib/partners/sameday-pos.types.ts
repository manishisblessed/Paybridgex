// ---------------------------------------------------------------------------
// Same Day Solution — POS Partner API types
// Matched to ACTUAL API response shapes (verified against live endpoints)
// ---------------------------------------------------------------------------

export type PosTransactionStatus =
  | "AUTHORIZED"
  | "CAPTURED"
  | "FAILED"
  | "REFUNDED"
  | "VOIDED";

export type PosPaymentMode =
  | "CARD"
  | "UPI"
  | "NFC"
  | "CASH"
  | "WALLET"
  | "NETBANKING"
  | "BHARATQR";

export type PosMachineStatus =
  | "active"
  | "inactive"
  | "maintenance"
  | "decommissioned";

export type PosExportFormat = "csv" | "pdf" | "zip";

export type PosExportJobStatus =
  | "QUEUED"
  | "PROCESSING"
  | "COMPLETED"
  | "FAILED";

// ── Request types ──

export interface PosTransactionsRequest {
  date_from: string;
  date_to: string;
  status?: PosTransactionStatus | null;
  terminal_id?: string | null;
  payment_mode?: PosPaymentMode | null;
  page?: number;
  page_size?: number;
}

export interface PosMachinesQuery {
  page?: number;
  limit?: number;
  status?: PosMachineStatus;
  machine_type?: string;
  search?: string;
}

export interface PosExportRequest {
  format: PosExportFormat;
  date_from: string;
  date_to: string;
  status?: PosTransactionStatus | null;
  terminal_id?: string | null;
}

// ── Response types (matched to live API) ──

export interface PosTransactionRetailer {
  id: string;
  name: string;
  shopName: string | null;
  userCode: string | null;
  role: string;
}

export interface PosTransaction {
  id: number;
  razorpay_txn_id: string;
  external_ref: string;
  terminal_id: string;
  amount: string;
  status: PosTransactionStatus;
  rrn: string;
  card_brand: string;
  card_type: string;
  card_number: string;
  issuing_bank: string | null;
  card_classification: string | null;
  card_txn_type: string | null;
  acquiring_bank: string | null;
  payment_mode: string;
  device_serial: string;
  customer_name: string;
  payer_name: string;
  txn_type: string;
  auth_code: string;
  mid: string;
  currency: string;
  receipt_url: string;
  posting_date: string;
  txn_time: string;
  created_at: string;
  retailer?: PosTransactionRetailer | null;
}

export interface PosTransactionsPagination {
  page: number;
  page_size: number;
  total_records: number;
  total_pages: number;
  has_next: boolean;
  has_prev: boolean;
}

export interface PosTransactionsSummary {
  total_transactions: number;
  total_amount: string;
  authorized_count: number;
  captured_count: number;
  failed_count: number;
  refunded_count: number;
  captured_amount: string;
  terminal_count: number;
}

export interface PosTransactionsResponse {
  success: boolean;
  company: string;
  data: PosTransaction[];
  pagination: PosTransactionsPagination;
  summary: PosTransactionsSummary;
}

export interface PosMachine {
  id: string;
  machine_id: string;
  serial_number: string;
  mid: string;
  tid: string;
  brand: string;
  machine_type: string;
  status: PosMachineStatus;
  inventory_status: string;
  delivery_date: string | null;
  installation_date: string | null;
  location: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface PosMachinesPagination {
  page: number;
  limit: number;
  total: number;
  total_pages: number;
  has_next_page: boolean;
  has_prev_page: boolean;
}

export interface PosMachinesResponse {
  success: boolean;
  company?: string;
  data: PosMachine[];
  pagination: PosMachinesPagination;
}

export interface PosExportJob {
  id: string;
  status: PosExportJobStatus;
  format: PosExportFormat;
  file_url: string | null;
  file_size_bytes?: number;
  record_count?: number;
  created_at: string;
  completed_at: string | null;
  expires_at?: string;
}

export interface PosExportCreateResponse {
  success: boolean;
  data: {
    message: string;
    job_id: string;
    format: PosExportFormat;
    status: PosExportJobStatus;
    remaining_exports_today: number;
  };
}

export interface PosExportStatusResponse {
  success: boolean;
  data: {
    job: PosExportJob;
  };
}

export interface PosApiError {
  success: false;
  error: {
    code: string;
    message: string;
  };
}

// ---------------------------------------------------------------------------
// Local assignment layer (our DB) — mirrors the external feed and adds the
// assignment of a physical terminal to a platform user.
// ---------------------------------------------------------------------------

export interface PosAssignee {
  id: string;
  name: string;
  phone: string;
  role: string;
}

/** A locally-synced POS machine, including assignment. */
export interface LocalPosMachine {
  id: string;
  externalId: string;
  mid: string | null;
  tid: string | null;
  serial: string | null;
  model: string | null;
  provider: string;
  status: string;
  location: string | null;
  city: string | null;
  state: string | null;
  assignedUserId: string | null;
  assignedAt: string | null;
  assignee: PosAssignee | null;
  syncedAt: string;
}

/** Per-user fleet breakdown row (direct assignments + outstanding rental dues). */
export interface PosFleetByUser {
  userId: string;
  name: string;
  email: string | null;
  role: string | null;
  machineCount: number;
  outstandingDues: number;
}

export interface LocalPosMachinesResponse {
  data: LocalPosMachine[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    hasPrev: boolean;
    hasNext: boolean;
  };
  stats: {
    total: number;
    assigned: number;
    unassigned: number;
  };
  byUser?: PosFleetByUser[];
}

/** User-facing (ownership-scoped) list of assigned machines. */
export interface MyPosMachinesResponse {
  data: LocalPosMachine[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    hasPrev: boolean;
    hasNext: boolean;
  };
  stats: {
    total: number;
    active: number;
  };
}

export interface PosSyncResult {
  ok: true;
  scanned: number;
  created: number;
  updated: number;
  /** Unused synced rows hard-deleted because they were absent from this pull. */
  removed: number;
  /**
   * Stale synced rows retired (`decommissioned`) in place instead of deleted
   * because they still hold a rental subscription or an active assignee.
   */
  retired: number;
  /** Distinct machines collected across all crawl passes (the union). */
  distinct: number;
  /** Machine count the partner claims exists (max `pagination.total` seen). */
  expected: number;
  /**
   * Whether the union covered `expected` (or the account is genuinely empty),
   * making destructive reconcile safe to run. When false, the partner's
   * pagination dropped rows and reconcile is skipped to protect live terminals.
   */
  complete: boolean;
  /** Number of full crawl passes performed to converge on the inventory. */
  passes: number;
}

// ---------------------------------------------------------------------------
// Terminal tree (cascading hierarchy filters for POS transactions page)
// ---------------------------------------------------------------------------

export interface TerminalTreeMember {
  id: string;
  name: string;
  role: string;
  parentId: string | null;
}

export interface TerminalTreeTerminal {
  tid: string;
  mid: string | null;
  model: string | null;
  location: string | null;
  city: string | null;
  ownerId: string | null;
  ownerName?: string | null;
  ownerRole?: string | null;
  assignedAt: string | null;
}

export interface PosTerminalTreeResponse {
  callerRole: string;
  members: TerminalTreeMember[];
  terminals: TerminalTreeTerminal[];
}
