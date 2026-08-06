import nodemailer, { type Transporter } from 'nodemailer';

import { env } from '../config/env.js';
import type { Logger } from '../logger/index.js';
import { createLogger } from '../logger/index.js';

const log: Logger = createLogger('auth:email');

let transporter: Transporter | null = null;

function hasSmtpConfig(): boolean {
    return env.SMTP_HOST !== '' && env.SMTP_USER !== '' && env.SMTP_PASS !== '';
}

function getTransport(): Transporter | null {
    if (transporter !== null) {
        return transporter;
    }
    if (!hasSmtpConfig()) {
        return null;
    }
    transporter = nodemailer.createTransport({
        host: env.SMTP_HOST,
        port: env.SMTP_PORT,
        secure: env.SMTP_PORT === 465,
        auth: {
            user: env.SMTP_USER,
            pass: env.SMTP_PASS,
        },
    });
    return transporter;
}

export async function sendVerificationEmail(email: string, verificationCode: string): Promise<void> {
    const mailer = getTransport();
    if (mailer === null) {
        log.warn(`SMTP 未配置，验证码将以日志形式输出（开发模式）`);
        log.info(`[验证码] 收件人=${email} code=${verificationCode}`);
        return;
    }

    await mailer.sendMail({
        from: env.SMTP_FROM !== '' ? env.SMTP_FROM : env.SMTP_USER,
        to: email,
        subject: 'MmaGuessr 邮箱验证码',
        text: `您的验证码是：${verificationCode}，10 分钟内有效。若非本人操作，请忽略本邮件。`,
    });
    log.info(`已向 ${email} 发送验证码邮件`);
}
