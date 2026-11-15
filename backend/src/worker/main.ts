import nodemailer from 'nodemailer';
import { startEmailWorker } from './email-worker.js';

// Any SMTP service works: a real provider (see .env.example) or Mailpit, the local mail catcher.
const {
  SMTP_HOST = 'localhost',
  SMTP_PORT = '1025',
  SMTP_USER,
  SMTP_PASS,
  MAIL_FROM,
} = process.env;
const transport = nodemailer.createTransport({
  host: SMTP_HOST,
  port: Number(SMTP_PORT),
  secure: Number(SMTP_PORT) === 465,
  auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
  connectionTimeout: 10_000, // a dead mail server must not block the worker forever
  socketTimeout: 15_000,
});

const worker = await startEmailWorker(async (email) => {
  await transport.sendMail({ from: MAIL_FROM ?? 'shop@example.com', ...email });
});
console.log(`email worker ready (SMTP ${SMTP_HOST}:${SMTP_PORT})`);

process.on('SIGTERM', async () => {
  await worker.close();
  process.exit(0);
});
