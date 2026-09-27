import nodemailer, { Transporter } from 'nodemailer';
import crypto from 'node:crypto';
import { env } from '../config/env';
import { logger } from '../utils/logger';

/**
 * Authoritative Email Service
 * Source: PhotoMemories_Backend_PRD_V2.pdf (Pages 3, 6, 11-12, 23, 26, 28)
 * - "Email sending (uses Nodemailer)"
 * - "Hash password, create subdomain, send verification email"
 * - "POST /api/auth/verify-email"
 * - "POST /api/auth/forgot-password & reset-password"
 * - "Never send plain passwords in logs/emails"
 */

export const PASSWORD_RESET_EXPIRY_MS = 60 * 60 * 1000; // 1 hour expiration

export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface SentEmailRecord {
  to: string;
  subject: string;
  html: string;
  text: string;
  timestamp: Date;
}

// In-memory test store for assertions during unit/integration tests
export const sentEmailsLog: SentEmailRecord[] = [];

/**
 * Creates and configures the Nodemailer transporter.
 */
function createTransporter(): Transporter {
  if (env.NODE_ENV === 'test') {
    // In test environment, use nodemailer jsonTransport to avoid network calls
    return nodemailer.createTransport({
      jsonTransport: true,
    });
  }

  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: env.EMAIL_USER,
      pass: env.EMAIL_PASSWORD,
    },
  });
}

const transporter = createTransporter();

/**
 * Generates a cryptographically secure random hex token (64 hex characters / 32 bytes).
 */
export function generateSecureToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Constructs the frontend email verification URL.
 */
export function buildVerificationUrl(token: string): string {
  return `${env.FRONTEND_URL}/verify-email?token=${encodeURIComponent(token)}`;
}

/**
 * Constructs the frontend password reset URL.
 */
export function buildPasswordResetUrl(token: string): string {
  return `${env.FRONTEND_URL}/reset-password?token=${encodeURIComponent(token)}`;
}

/**
 * Core email sender utility.
 */
export async function sendEmail(options: SendEmailOptions): Promise<boolean> {
  const from = `PhotoMemories AI <${env.EMAIL_USER}>`;

  try {
    if (env.NODE_ENV === 'test') {
      sentEmailsLog.push({
        to: options.to,
        subject: options.subject,
        html: options.html,
        text: options.text,
        timestamp: new Date(),
      });
    }

    await transporter.sendMail({
      from,
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
    });

    logger.info(`Email successfully dispatched to [${options.to}] (Subject: "${options.subject}")`);
    return true;
  } catch (error) {
    // Sanitize error: never log credentials or tokens
    logger.error(`Failed to send email to [${options.to}]`, {
      subject: options.subject,
      error: error instanceof Error ? error.message : error,
    });
    return false;
  }
}

/**
 * Sends an email verification link to a newly registered user.
 * Triggered during POST /api/auth/signup per PRD Page 11-12.
 */
export async function sendVerificationEmail(
  to: string,
  token: string,
  name?: string
): Promise<boolean> {
  const verificationUrl = buildVerificationUrl(token);
  const greeting = name ? `Hello ${name},` : 'Hello,';

  const subject = 'Verify your PhotoMemories AI account';
  const html = `
    <div style="font-family: sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #4f46e5;">Welcome to PhotoMemories AI</h2>
      <p>${greeting}</p>
      <p>Thank you for signing up. Please verify your email address to activate your account and start setting up your photographer albums:</p>
      <p style="margin: 24px 0;">
        <a href="${verificationUrl}" style="background-color: #4f46e5; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">
          Verify Email Address
        </a>
      </p>
      <p style="font-size: 14px; color: #666;">Or copy and paste this link into your browser:</p>
      <p style="font-size: 14px; color: #4f46e5; word-break: break-all;">${verificationUrl}</p>
      <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
      <p style="font-size: 12px; color: #9ca3af;">If you did not create an account with PhotoMemories AI, please ignore this email.</p>
    </div>
  `;

  const text = `
    Welcome to PhotoMemories AI
    ${greeting}
    
    Please verify your email address by visiting the following link:
    ${verificationUrl}
    
    If you did not create an account with PhotoMemories AI, please ignore this email.
  `.trim();

  return sendEmail({ to, subject, html, text });
}

/**
 * Sends a password reset link to a user.
 * Triggered during POST /api/auth/forgot-password per PRD Page 12.
 */
export async function sendPasswordResetEmail(
  to: string,
  token: string,
  name?: string
): Promise<boolean> {
  const resetUrl = buildPasswordResetUrl(token);
  const greeting = name ? `Hello ${name},` : 'Hello,';

  const subject = 'Reset your PhotoMemories AI password';
  const html = `
    <div style="font-family: sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #4f46e5;">Password Reset Request</h2>
      <p>${greeting}</p>
      <p>We received a request to reset your PhotoMemories AI password. Click the button below to choose a new password:</p>
      <p style="margin: 24px 0;">
        <a href="${resetUrl}" style="background-color: #4f46e5; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">
          Reset Password
        </a>
      </p>
      <p style="font-size: 14px; color: #666;">This link will expire in 1 hour.</p>
      <p style="font-size: 14px; color: #4f46e5; word-break: break-all;">${resetUrl}</p>
      <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
      <p style="font-size: 12px; color: #9ca3af;">If you did not request a password reset, you can safely ignore this email.</p>
    </div>
  `;

  const text = `
    Password Reset Request
    ${greeting}
    
    We received a request to reset your PhotoMemories AI password. Use the link below to choose a new password (link expires in 1 hour):
    ${resetUrl}
    
    If you did not request a password reset, please ignore this email.
  `.trim();

  return sendEmail({ to, subject, html, text });
}

/**
 * Sends payment confirmation email to photographer.
 * Source: PRD Page 13: "Send email to photographer: 'Admin will create your pages'"
 */
export async function sendPhotographerPaymentConfirmationEmail(
  to: string,
  photographerName?: string,
  eventName?: string
): Promise<boolean> {
  const greeting = photographerName ? `Hello ${photographerName},` : 'Hello,';
  const eventTitle = eventName || 'your event';

  const subject = `Payment Confirmed: Admin will create your pages for ${eventTitle}`;
  const html = `
    <div style="font-family: sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #4f46e5;">Payment Received Successfully</h2>
      <p>${greeting}</p>
      <p>Your payment for <strong>${eventTitle}</strong> has been received and confirmed.</p>
      <p>Our admin team (Krish) has been notified and will now design your custom invitation card and landing page.</p>
      <p>Once the design is complete, your event will be marked as <strong>ready_for_upload</strong> and you will receive an email notification to start uploading your photos and videos.</p>
      <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
      <p style="font-size: 12px; color: #9ca3af;">PhotoMemories AI — Automated Notification</p>
    </div>
  `;

  const text = `
    Payment Received Successfully
    ${greeting}

    Your payment for ${eventTitle} has been confirmed.
    Admin will create your pages (invitation card and landing page).
    You will be notified as soon as your album is ready for photo upload.
  `.trim();

  return sendEmail({ to, subject, html, text });
}

/**
 * Sends notification email to Admin (Krish) when a photographer makes a payment.
 * Source: PRD Page 13: "Send email to admin (Krish): 'New request from photographer X'"
 */
export async function sendAdminPaymentNotificationEmail(
  adminEmail: string,
  photographerName: string,
  photographerEmail: string,
  eventName: string,
  eventId: number,
  plan: string,
  amount: number
): Promise<boolean> {
  const subject = `New request from photographer ${photographerName}`;
  const html = `
    <div style="font-family: sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #4f46e5;">New Paid Event Request Received</h2>
      <p>Hello Krish,</p>
      <p>A new event request has been paid and is waiting for design:</p>
      <ul>
        <li><strong>Event ID:</strong> #${eventId}</li>
        <li><strong>Event Name:</strong> ${eventName}</li>
        <li><strong>Photographer:</strong> ${photographerName} (${photographerEmail})</li>
        <li><strong>Plan:</strong> ${plan}</li>
        <li><strong>Amount Paid:</strong> ₹${amount}</li>
      </ul>
      <p>Please design the invitation card and landing page in Figma, then mark the event as ready for upload via the admin panel.</p>
      <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
      <p style="font-size: 12px; color: #9ca3af;">PhotoMemories AI — Admin Dispatch</p>
    </div>
  `;

  const text = `
    New Paid Event Request Received
    Hello Krish,

    New request from photographer ${photographerName} (${photographerEmail}):
    Event: #${eventId} ${eventName}
    Plan: ${plan}
    Amount Paid: ₹${amount}

    Please design the invitation card and landing page.
  `.trim();

  return sendEmail({ to: adminEmail, subject, html, text });
}

/**
 * Sends notification email to photographer when admin marks an event ready for upload.
 * Source: PRD Pages 18-19: "Send email to photographer: 'Album ready! Upload your photos'"
 */
export async function sendPhotographerAlbumReadyEmail(
  to: string,
  photographerName?: string,
  eventName?: string
): Promise<boolean> {
  const greeting = photographerName ? `Hello ${photographerName},` : 'Hello,';
  const eventTitle = eventName || 'your event';

  const subject = `Album ready! Upload your photos for ${eventTitle}`;
  const html = `
    <div style="font-family: sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #4f46e5;">Your Album is Ready for Upload</h2>
      <p>${greeting}</p>
      <p>Great news! The invitation card and landing page for <strong>${eventTitle}</strong> have been designed and published.</p>
      <p>Your event is now in <strong>ready_for_upload</strong> status. You can now upload your high-resolution photos and videos from your photographer dashboard.</p>
      <p style="margin: 24px 0;">
        <a href="${env.FRONTEND_URL}/dashboard" style="background-color: #4f46e5; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">
          Go to Dashboard & Upload Photos
        </a>
      </p>
      <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
      <p style="font-size: 12px; color: #9ca3af;">PhotoMemories AI — Automated Notification</p>
    </div>
  `;

  const text = `
    Your Album is Ready for Upload
    ${greeting}

    Great news! The invitation card and landing page for ${eventTitle} have been designed.
    Your album is now ready! Upload your photos from your dashboard:
    ${env.FRONTEND_URL}/dashboard
  `.trim();

  return sendEmail({ to, subject, html, text });
}

