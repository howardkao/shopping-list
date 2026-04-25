const CORAL = '#FF7A7A';
const FONT_STACK = "'Plus Jakarta Sans', 'Helvetica Neue', Arial, sans-serif";

const formatExpiry = (expiresAt) => {
  const d = new Date(expiresAt);
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
};

export const inviteEmailHtml = ({ joinUrl, expiresAt }) => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>You've been invited to Provisions</title>
</head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:${FONT_STACK};">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e5e7eb;">

          <!-- Header -->
          <tr>
            <td style="padding:32px 40px 24px;border-bottom:1px solid #f3f4f6;">
              <span style="font-size:22px;font-weight:800;color:${CORAL};letter-spacing:-0.5px;">Provisions</span>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:32px 40px;">
              <h1 style="margin:0 0 12px;font-size:24px;font-weight:800;color:#111827;letter-spacing:-0.5px;">
                You've been invited
              </h1>
              <p style="margin:0 0 28px;font-size:15px;line-height:1.6;color:#4b5563;">
                Someone added you to their household on Provisions — tap the button below to accept.
              </p>

              <!-- CTA -->
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td style="border-radius:12px;background:${CORAL};">
                    <a href="${joinUrl}"
                       style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:12px;">
                      Accept Invite
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin:20px 0 0;font-size:13px;color:#9ca3af;">
                This invite expires ${formatExpiry(expiresAt)}.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:20px 40px;border-top:1px solid #f3f4f6;">
              <p style="margin:0;font-size:12px;color:#9ca3af;line-height:1.5;">
                If you weren't expecting this, you can safely ignore it. This link works only once.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

export const inviteEmailText = ({ joinUrl, expiresAt }) =>
`You've been invited to Provisions

Someone added you to their household on Provisions. Tap the link below to accept:

${joinUrl}

This invite expires ${formatExpiry(expiresAt)}.

If you weren't expecting this, you can safely ignore it. This link works only once.
`;
