// Transactional email via Resend, over plain `fetch` (no SDK dep — matches the
// thin-client posture of posthog/server.ts). OFF by default: with no RESEND_API_KEY
// configured, sendEmail no-ops with a warning, so self-host/dev runs without email
// (verification just isn't sent — fine, since requireEmailVerification is false).
// Errors are swallowed (logged) so an email failure never breaks signup.

export function emailConfigured(): boolean {
  return !!process.env.RESEND_API_KEY?.trim()
}

const from = (): string => process.env.SYNEK_EMAIL_FROM?.trim() || 'Synek <onboarding@resend.dev>'

export async function sendEmail(opts: { to: string; subject: string; html: string }): Promise<void> {
  const key = process.env.RESEND_API_KEY?.trim()
  if (!key) {
    console.warn(`[email] RESEND_API_KEY not set — skipped "${opts.subject}" to ${opts.to}`)
    return
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: from(), to: opts.to, subject: opts.subject, html: opts.html }),
    })
    if (!res.ok) console.error(`[email] Resend ${res.status}: ${(await res.text().catch(() => '')).slice(0, 300)}`)
  } catch (err) {
    console.error('[email] send failed:', err instanceof Error ? err.message : err)
  }
}

// A tiny shared shell so the two transactional emails look consistent without a
// templating dep. Inline styles only (email clients ignore <style>/external CSS).
function shell(heading: string, body: string, cta: { url: string; label: string }): string {
  return `<!doctype html><html><body style="margin:0;background:#0b0b0f;padding:32px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#e7e7ea">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" width="100%" style="max-width:480px;background:#15151c;border:1px solid #26262f;border-radius:14px;padding:32px">
      <tr><td style="font-size:18px;font-weight:700;letter-spacing:-0.01em;padding-bottom:8px">Synek</td></tr>
      <tr><td style="font-size:20px;font-weight:600;padding-bottom:12px">${heading}</td></tr>
      <tr><td style="font-size:14px;line-height:1.6;color:#b6b6c0;padding-bottom:24px">${body}</td></tr>
      <tr><td><a href="${cta.url}" style="display:inline-block;background:#6d5efc;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:11px 20px;border-radius:9px">${cta.label}</a></td></tr>
      <tr><td style="font-size:12px;color:#6b6b78;padding-top:24px;word-break:break-all">If the button doesn't work, paste this link:<br>${cta.url}</td></tr>
    </table>
  </td></tr></table>
</body></html>`
}

export function verificationEmailTemplate(url: string): { subject: string; html: string } {
  return {
    subject: 'Verify your Synek email',
    html: shell(
      'Confirm your email',
      'Welcome to Synek. Confirm this address to secure your account and enable password recovery.',
      { url, label: 'Verify email' },
    ),
  }
}

export function resetPasswordEmailTemplate(url: string): { subject: string; html: string } {
  return {
    subject: 'Reset your Synek password',
    html: shell(
      'Reset your password',
      "We received a request to reset your Synek password. This link expires in an hour. If you didn't ask for this, you can ignore this email.",
      { url, label: 'Set a new password' },
    ),
  }
}
