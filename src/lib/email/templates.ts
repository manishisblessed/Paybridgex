/**
 * Transactional email templates.
 *
 * Design constraints (email is not the web):
 * - Table-based layout — Gmail/Outlook still don't reliably render flexbox.
 * - All styles inline — most clients strip <style> blocks.
 * - System font stack — no external @font-face (blocked by many clients).
 * - Max width 600px, single column — the mobile-safe standard.
 * - Preheader text — the muted line inbox previews show next to the subject.
 * - No JS, no external images beyond the sender's discretion.
 *
 * Palette matches tailwind.config.ts (brand.* / accent.*) so marketing emails
 * feel continuous with the dashboard.
 */

const BRAND = {
  primary: "#1b45ea", // brand-600 (royal blue)
  primaryDark: "#192a82", // brand-900
  primarySoft: "#eef4ff", // brand-50
  accent: "#10b981", // accent-500 (emerald)
  ink: "#0e1626", // ink-900
  inkMuted: "#516a8c", // ink-500
  inkLight: "#a4b3c8", // ink-300
  border: "#d9e6ff", // brand-100
  bg: "#f5f7fa", // ink-50
} as const;

const ROLE_LABEL: Record<string, string> = {
  RETAILER: "Retailer",
  DISTRIBUTOR: "Distributor",
  MASTER_DISTRIBUTOR: "Master Distributor",
  SUPER_DISTRIBUTOR: "Super Distributor",
  ADMIN: "Admin",
  SUB_ADMIN: "Sub-Admin",
  SUPPORT: "Support",
};

function fmtRole(role: string) {
  return ROLE_LABEL[role] ?? role.replace(/_/g, " ");
}

function fmtExpiry(expiresAt: Date | string) {
  const d = typeof expiresAt === "string" ? new Date(expiresAt) : expiresAt;
  return d.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/**
 * Wraps the email body in a mobile-safe, inbox-safe outer shell with the
 * brand header, footer and a hidden preheader. Callers supply the inner
 * HTML — everything around it (fonts, layout table, footer) is standard.
 */
function shell({
  preheader,
  bodyHtml,
}: {
  preheader: string;
  bodyHtml: string;
}) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <meta name="color-scheme" content="light only" />
    <meta name="supported-color-schemes" content="light" />
    <title>Paybridgex</title>
    <!--[if mso]><style>* { font-family: Arial, sans-serif !important; }</style><![endif]-->
  </head>
  <body style="margin:0;padding:0;background:${BRAND.bg};color:${BRAND.ink};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">
      ${preheader}
      &nbsp;&#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847;
    </div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND.bg};padding:32px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 10px 30px rgba(26,35,80,0.08);">
            <tr>
              <td style="background:linear-gradient(135deg,${BRAND.primary} 0%,${BRAND.primaryDark} 100%);padding:32px 32px 28px 32px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td>
                      <div style="display:inline-block;background:rgba(255,255,255,0.14);padding:8px 14px;border-radius:10px;">
                        <span style="color:#ffffff;font-size:20px;font-weight:800;letter-spacing:0.3px;">Paybridgex</span>
                      </div>
                      <div style="color:rgba(255,255,255,0.72);font-size:11px;font-weight:600;letter-spacing:2px;margin-top:10px;text-transform:uppercase;">PG &middot; POS &middot; QR Payments</div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:36px 40px 8px 40px;">
                ${bodyHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:24px 40px 32px 40px;">
                <div style="border-top:1px solid ${BRAND.border};padding-top:20px;font-size:12px;line-height:18px;color:${BRAND.inkMuted};">
                  <div style="font-weight:700;color:${BRAND.ink};margin-bottom:4px;">K.A. PAYBRIDGEX SOLUTION (OPC) PRIVATE LIMITED</div>
                  <div>Ahmedabad, Gujarat, India &middot; <a href="https://paybridgex.in" style="color:${BRAND.primary};text-decoration:none;">paybridgex.in</a></div>
                  <div style="margin-top:12px;color:${BRAND.inkLight};">You are receiving this email because someone from your organisation invited you to Paybridgex. If this wasn't you, you can safely ignore this message.</div>
                </div>
              </td>
            </tr>
          </table>
          <div style="max-width:600px;margin:16px auto 0;font-size:11px;color:${BRAND.inkLight};text-align:center;">
            &copy; ${new Date().getFullYear()} K.A. PAYBRIDGEX SOLUTION (OPC) PRIVATE LIMITED. All rights reserved.
          </div>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

/**
 * Onboarding invite email — sent on invite creation and on manual resend.
 * Same visual language for both; `isReminder=true` just re-frames copy so
 * the recipient understands this is a nudge rather than the first contact.
 */
export function renderInviteEmail(opts: {
  name?: string;
  role: string;
  onboardingLink: string;
  expiresAt: Date | string;
  isReminder?: boolean;
}): { subject: string; html: string } {
  const roleLabel = fmtRole(opts.role);
  const expiry = fmtExpiry(opts.expiresAt);
  const firstName = opts.name?.split(" ")[0]?.trim();
  const greeting = firstName ? `Hello ${firstName},` : "Hello,";

  const preheader = opts.isReminder
    ? `Reminder — finish setting up your ${roleLabel} account on Paybridgex. Link expires ${expiry}.`
    : `You've been invited to join Paybridgex as a ${roleLabel}. Complete your onboarding in under 5 minutes.`;

  const subject = opts.isReminder
    ? `Reminder: complete your Paybridgex ${roleLabel} onboarding`
    : `You're invited to Paybridgex — start earning as a ${roleLabel}`;

  const headline = opts.isReminder
    ? "Your Paybridgex invite is still waiting"
    : "Welcome to Paybridgex";

  const subhead = opts.isReminder
    ? `Just a friendly nudge — your onboarding link expires on <strong>${expiry}</strong>. It only takes a few minutes to finish.`
    : `You've been invited to join our merchant network. Complete a quick onboarding and start using the platform today.`;

  const featureRow = (icon: string, title: string, copy: string) => `
    <tr>
      <td style="padding:10px 0;" valign="top">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td valign="top" style="width:36px;padding-right:14px;">
              <div style="width:36px;height:36px;border-radius:10px;background:${BRAND.primarySoft};color:${BRAND.primary};text-align:center;line-height:36px;font-size:16px;font-weight:800;">${icon}</div>
            </td>
            <td valign="top">
              <div style="font-size:14px;font-weight:700;color:${BRAND.ink};line-height:20px;">${title}</div>
              <div style="font-size:13px;color:${BRAND.inkMuted};line-height:19px;margin-top:2px;">${copy}</div>
            </td>
          </tr>
        </table>
      </td>
    </tr>`;

  const body = `
    <div style="display:inline-block;background:${BRAND.primarySoft};color:${BRAND.primary};font-size:11px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;padding:6px 12px;border-radius:999px;">
      ${opts.isReminder ? "Reminder" : "You're invited"}
    </div>
    <h1 style="font-size:26px;line-height:34px;color:${BRAND.ink};margin:14px 0 10px 0;font-weight:800;letter-spacing:-0.3px;">
      ${headline}
    </h1>
    <p style="font-size:15px;line-height:24px;color:${BRAND.inkMuted};margin:0 0 8px 0;">${greeting}</p>
    <p style="font-size:15px;line-height:24px;color:${BRAND.inkMuted};margin:0 0 20px 0;">${subhead}</p>

    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 22px 0;">
      <tr>
        <td style="background:${BRAND.primarySoft};border:1px solid ${BRAND.border};padding:14px 18px;border-radius:12px;">
          <div style="font-size:11px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;color:${BRAND.primary};margin-bottom:4px;">Your role</div>
          <div style="font-size:18px;font-weight:800;color:${BRAND.primaryDark};">${roleLabel}</div>
        </td>
      </tr>
    </table>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 28px 0;">
      <tr>
        <td align="left">
          <a href="${opts.onboardingLink}" style="display:inline-block;background:linear-gradient(135deg,${BRAND.primary} 0%,${BRAND.primaryDark} 100%);color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:14px 30px;border-radius:12px;box-shadow:0 8px 20px rgba(46,73,173,0.35);">
            Complete registration &rarr;
          </a>
        </td>
      </tr>
    </table>

    <div style="border:1px dashed ${BRAND.border};border-radius:10px;padding:12px 14px;margin:0 0 24px 0;font-size:12px;color:${BRAND.inkMuted};word-break:break-all;">
      <div style="font-weight:700;color:${BRAND.ink};margin-bottom:4px;">Or paste this link in your browser</div>
      <a href="${opts.onboardingLink}" style="color:${BRAND.primary};text-decoration:none;">${opts.onboardingLink}</a>
    </div>

    <div style="font-size:13px;font-weight:700;color:${BRAND.ink};margin:8px 0 4px 0;">What you'll get</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:20px;">
      ${featureRow("&#8377;", "60+ digital services", "AePS, DMT, UPI collections, recharges, bill payments and more")}
      ${featureRow("&#9635;", "PG, POS &amp; QR Payment Services", "Accept payments in-store with our POS machines and static QR")}
      ${featureRow("&#9679;", "Live wallet, &amp; ledger support", "Real-time commissions, settlements and downloadable statements")}
    </table>

    <div style="background:#fff8ec;border:1px solid #fde3a4;border-radius:10px;padding:12px 14px;font-size:13px;color:#7a5300;line-height:19px;">
      <strong>Heads up:</strong> This invite link expires on <strong>${expiry}</strong>. Please complete your registration before then.
    </div>

    <p style="font-size:13px;color:${BRAND.inkMuted};line-height:20px;margin:24px 0 0 0;">
      Need help?, If this was not you Just reply to this email &mdash; Our custumer support executive will get back to you.
    </p>
    <p style="font-size:14px;color:${BRAND.ink};line-height:20px;margin:18px 0 8px 0;">
      Cheers,<br/>
      <strong>Team Paybridgex</strong>
    </p>
  `;

  return { subject, html: shell({ preheader, bodyHtml: body }) };
}

/**
 * Sent when an admin flags specific uploaded documents for re-upload. The
 * applicant keeps everything else they've already verified — they only need to
 * re-submit the listed documents via the fresh, targeted link.
 */
export function renderDocResubmissionEmail(opts: {
  name?: string;
  role: string;
  resubmitLink: string;
  expiresAt: Date | string;
  documents: { label: string; reason: string }[];
}): { subject: string; html: string } {
  const roleLabel = fmtRole(opts.role);
  const expiry = fmtExpiry(opts.expiresAt);
  const firstName = opts.name?.split(" ")[0]?.trim();
  const greeting = firstName ? `Hello ${firstName},` : "Hello,";

  const subject = "Action needed: re-upload a few documents for Paybridgex";
  const preheader = `A few of your documents need to be re-uploaded. It only takes a minute — link expires ${expiry}.`;

  const docRows = opts.documents
    .map(
      (d) => `
    <tr>
      <td style="padding:12px 14px;border:1px solid ${BRAND.border};border-radius:10px;background:#fff8ec;">
        <div style="font-size:14px;font-weight:700;color:${BRAND.ink};line-height:20px;">${escapeHtml(d.label)}</div>
        <div style="font-size:13px;color:#7a5300;line-height:19px;margin-top:3px;"><strong>Reason:</strong> ${escapeHtml(d.reason)}</div>
      </td>
    </tr>
    <tr><td style="height:8px;line-height:8px;font-size:8px;">&nbsp;</td></tr>`
    )
    .join("");

  const body = `
    <div style="display:inline-block;background:#fff1f2;color:${BRAND.accent};font-size:11px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;padding:6px 12px;border-radius:999px;">
      Documents to re-upload
    </div>
    <h1 style="font-size:26px;line-height:34px;color:${BRAND.ink};margin:14px 0 10px 0;font-weight:800;letter-spacing:-0.3px;">
      A quick re-upload is needed
    </h1>
    <p style="font-size:15px;line-height:24px;color:${BRAND.inkMuted};margin:0 0 8px 0;">${greeting}</p>
    <p style="font-size:15px;line-height:24px;color:${BRAND.inkMuted};margin:0 0 20px 0;">
      Thanks for completing your <strong style="color:${BRAND.ink};">${roleLabel}</strong> onboarding. Our team reviewed your submission and a few documents need to be re-uploaded. <strong>You don't need to redo anything else</strong> — just replace the documents listed below.
    </p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 22px 0;">
      ${docRows}
    </table>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 28px 0;">
      <tr>
        <td align="left">
          <a href="${opts.resubmitLink}" style="display:inline-block;background:linear-gradient(135deg,${BRAND.primary} 0%,${BRAND.primaryDark} 100%);color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:14px 30px;border-radius:12px;box-shadow:0 8px 20px rgba(46,73,173,0.35);">
            Re-upload documents &rarr;
          </a>
        </td>
      </tr>
    </table>

    <div style="border:1px dashed ${BRAND.border};border-radius:10px;padding:12px 14px;margin:0 0 24px 0;font-size:12px;color:${BRAND.inkMuted};word-break:break-all;">
      <div style="font-weight:700;color:${BRAND.ink};margin-bottom:4px;">Or paste this link in your browser</div>
      <a href="${opts.resubmitLink}" style="color:${BRAND.primary};text-decoration:none;">${opts.resubmitLink}</a>
    </div>

    <div style="background:#fff8ec;border:1px solid #fde3a4;border-radius:10px;padding:12px 14px;font-size:13px;color:#7a5300;line-height:19px;">
      <strong>Heads up:</strong> This re-upload link expires on <strong>${expiry}</strong>. Please re-submit before then so we can finish your review.
    </div>

    <p style="font-size:13px;color:${BRAND.inkMuted};line-height:20px;margin:24px 0 0 0;">
      Need help? Just reply to this email &mdash; our customer support executive will get back to you.
    </p>
    <p style="font-size:14px;color:${BRAND.ink};line-height:20px;margin:18px 0 8px 0;">
      Cheers,<br/>
      <strong>Team Paybridgex</strong>
    </p>
  `;

  return { subject, html: shell({ preheader, bodyHtml: body }) };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Internal alert sent to the support/ops inbox when a prospect submits the
 * public Join Form. There is NO account yet — this is a lead the team must
 * reach out to and convert into an onboarding invite.
 */
export function renderJoinRequestEmail(opts: {
  name: string;
  phone: string;
  email: string;
  role: string;
  shopName?: string | null;
  city?: string | null;
  state?: string | null;
  message?: string | null;
  reviewLink: string;
}): { subject: string; html: string } {
  const roleLabel = fmtRole(opts.role);
  const subject = `New join request — ${opts.name} (${roleLabel})`;
  const preheader = `${opts.name} wants to join Paybridgex as a ${roleLabel}. Reach out and start onboarding.`;

  const row = (label: string, value?: string | null) =>
    value
      ? `
    <tr>
      <td style="padding:11px 0;color:${BRAND.inkMuted};font-size:13px;width:130px;border-top:1px solid ${BRAND.border};" valign="top">${escapeHtml(label)}</td>
      <td style="padding:11px 0;color:${BRAND.ink};font-size:14px;font-weight:600;border-top:1px solid ${BRAND.border};">${escapeHtml(value)}</td>
    </tr>`
      : "";

  const body = `
    <div style="display:inline-block;background:${BRAND.primarySoft};color:${BRAND.primary};font-size:11px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;padding:6px 12px;border-radius:999px;">
      New join request
    </div>
    <h1 style="font-size:24px;line-height:32px;color:${BRAND.ink};margin:14px 0 10px 0;font-weight:800;letter-spacing:-0.3px;">
      ${escapeHtml(opts.name)} wants to join
    </h1>
    <p style="font-size:15px;line-height:24px;color:${BRAND.inkMuted};margin:0 0 20px 0;">
      A prospect submitted the Join Form on the website. No account has been created &mdash; please connect with them and start the onboarding process.
    </p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px 0;background:${BRAND.primarySoft};border:1px solid ${BRAND.border};border-radius:12px;">
      <tr>
        <td style="padding:6px 18px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td style="padding:11px 0;color:${BRAND.inkMuted};font-size:13px;width:130px;">Interested as</td>
              <td style="padding:11px 0;color:${BRAND.ink};font-size:14px;font-weight:700;">${roleLabel}</td>
            </tr>
            ${row("Mobile", opts.phone)}
            ${row("Email", opts.email)}
            ${row("Shop / Business", opts.shopName)}
            ${row("City", opts.city)}
            ${row("State", opts.state)}
            ${row("Message", opts.message)}
          </table>
        </td>
      </tr>
    </table>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px 0;">
      <tr>
        <td align="left">
          <a href="${opts.reviewLink}" style="display:inline-block;background:linear-gradient(135deg,${BRAND.primary} 0%,${BRAND.primaryDark} 100%);color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:14px 30px;border-radius:12px;box-shadow:0 8px 20px rgba(46,73,173,0.35);">
            Review in dashboard &rarr;
          </a>
        </td>
      </tr>
    </table>

    <p style="font-size:14px;color:${BRAND.ink};line-height:20px;margin:18px 0 8px 0;">
      &mdash; Paybridgex Platform
    </p>
  `;

  return { subject, html: shell({ preheader, bodyHtml: body }) };
}

/**
 * Sent when an admin approves a registered network-tier account (SD/MD/DT/RT).
 * Tells the user they can now log in.
 */
export function renderAccountApprovedEmail(opts: {
  name?: string;
  role: string;
  loginLink: string;
  email: string;
}): { subject: string; html: string } {
  const roleLabel = fmtRole(opts.role);
  const firstName = opts.name?.split(" ")[0]?.trim();
  const fullName = opts.name?.trim() || firstName || "there";
  const greeting = firstName ? `Dear ${fullName},` : "Dear user,";

  const subject = `Your Paybridgex ${roleLabel} account is approved`;
  const preheader = `Good news — your ${roleLabel} account is live. Sign in and start using Paybridgex.`;

  const body = `
    <div style="display:inline-block;background:#ecfdf5;color:#059669;font-size:11px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;padding:6px 12px;border-radius:999px;">
      Account approved
    </div>
    <h1 style="font-size:26px;line-height:34px;color:${BRAND.ink};margin:14px 0 10px 0;font-weight:800;letter-spacing:-0.3px;">
      You're approved${firstName ? `, ${firstName}` : ""}!
    </h1>
    <p style="font-size:15px;line-height:24px;color:${BRAND.inkMuted};margin:0 0 8px 0;">${greeting}</p>
    <p style="font-size:15px;line-height:24px;color:${BRAND.inkMuted};margin:0 0 20px 0;">
      Great news &mdash; your <strong style="color:${BRAND.ink};">${roleLabel}</strong> account on Paybridgex has been approved by our team. You can now sign in and access your dashboard.
    </p>

    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 22px 0;width:100%;">
      <tr>
        <td style="background:#ecfdf5;border:1px solid #a7f3d0;border-left:4px solid #059669;padding:14px 18px;border-radius:12px;">
          <div style="font-size:11px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;color:#059669;margin-bottom:4px;">Status</div>
          <div style="font-size:16px;font-weight:800;color:${BRAND.ink};">Active &mdash; ready to log in</div>
        </td>
      </tr>
    </table>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px 0;background:${BRAND.primarySoft};border:1px solid ${BRAND.border};border-radius:12px;">
      <tr>
        <td style="padding:6px 18px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td style="padding:12px 0;color:${BRAND.inkMuted};font-size:13px;width:110px;">Role</td>
              <td style="padding:12px 0;color:${BRAND.ink};font-size:14px;font-weight:700;text-align:right;">${roleLabel}</td>
            </tr>
            <tr>
              <td style="padding:12px 0;color:${BRAND.inkMuted};font-size:13px;border-top:1px solid ${BRAND.border};">Email</td>
              <td style="padding:12px 0;color:${BRAND.ink};font-size:14px;font-weight:600;text-align:right;border-top:1px solid ${BRAND.border};">${opts.email}</td>
            </tr>
            <tr>
              <td style="padding:12px 0;color:${BRAND.inkMuted};font-size:13px;border-top:1px solid ${BRAND.border};">Password</td>
              <td style="padding:12px 0;color:${BRAND.inkMuted};font-size:13px;font-style:italic;text-align:right;border-top:1px solid ${BRAND.border};">The one you set during registration</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 28px 0;">
      <tr>
        <td align="left">
          <a href="${opts.loginLink}" style="display:inline-block;background:linear-gradient(135deg,${BRAND.primary} 0%,${BRAND.primaryDark} 100%);color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:14px 30px;border-radius:12px;box-shadow:0 8px 20px rgba(46,73,173,0.35);">
            Login to your dashboard &rarr;
          </a>
        </td>
      </tr>
    </table>

    <div style="border:1px dashed ${BRAND.border};border-radius:10px;padding:12px 14px;margin:0 0 24px 0;font-size:12px;color:${BRAND.inkMuted};word-break:break-all;">
      <div style="font-weight:700;color:${BRAND.ink};margin-bottom:4px;">Or paste this link in your browser</div>
      <a href="${opts.loginLink}" style="color:${BRAND.primary};text-decoration:none;">${opts.loginLink}</a>
    </div>

    <p style="font-size:13px;color:${BRAND.inkMuted};line-height:20px;margin:8px 0 0 0;">
      On first login you may be asked to set up two-factor authentication &mdash; this keeps your account secure.
    </p>
    <p style="font-size:13px;color:${BRAND.inkMuted};line-height:20px;margin:16px 0 0 0;">
      Need help? Reply to this email or write to <a href="mailto:support@paybridgex.in" style="color:${BRAND.primary};text-decoration:none;font-weight:600;">support@paybridgex.in</a>.
    </p>
    <p style="font-size:14px;color:${BRAND.ink};line-height:20px;margin:18px 0 8px 0;">
      Cheers,<br/>
      <strong>Team Paybridgex</strong>
    </p>
  `;

  return { subject, html: shell({ preheader, bodyHtml: body }) };
}
