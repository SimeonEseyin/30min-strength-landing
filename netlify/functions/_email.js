async function sendEmail({ to, subject, text, html }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.PASSWORD_RESET_FROM_EMAIL || process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !from) {
    throw new Error('Account email delivery is not configured.');
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject,
      text,
      html,
    }),
  });

  if (!response.ok) {
    throw new Error(`Account email delivery failed (${response.status}).`);
  }
}

async function sendPasswordResetEmail({ to, resetUrl }) {
  return sendEmail({
    to,
    subject: 'Reset your DevDad Strength password',
    text: `Use this link to reset your password. It expires in 30 minutes:\n\n${resetUrl}\n\nIf you did not request this, you can ignore this email.`,
    html: `<p>Use the link below to reset your DevDad Strength password. It expires in 30 minutes.</p><p><a href="${resetUrl.replace(/&/g, '&amp;')}">Reset password</a></p><p>If you did not request this, you can ignore this email.</p>`,
  });
}

async function sendEmailVerification({ to, verificationUrl }) {
  return sendEmail({
    to,
    subject: 'Verify your DevDad Strength email',
    text: `Verify your email to activate your free DevDad Strength account:\n\n${verificationUrl}\n\nThis link expires in 24 hours.`,
    html: `<p>Verify your email to activate your free DevDad Strength account.</p><p><a href="${verificationUrl.replace(/&/g, '&amp;')}">Verify email and open my plan</a></p><p>This link expires in 24 hours.</p>`,
  });
}

module.exports = { sendPasswordResetEmail, sendEmailVerification };
