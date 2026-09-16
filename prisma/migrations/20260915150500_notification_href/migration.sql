-- Notification deep-link: optional in-app href a notification redirects to on
-- click (e.g. "/dashboard/admin/pos-bookings"). Additive, nullable — safe online.
ALTER TABLE "Notification" ADD COLUMN "href" TEXT;

-- Recent-first feed lookups per user.
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");
