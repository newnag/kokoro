const nodemailer = require('nodemailer');
const axios = require('axios');
const AlertSetting = require('../models/AlertSetting');
require('dotenv').config();

class NotificationService {
  static async sendDownAlert(website, checkResult) {
    await this.sendLarkAlert(website, checkResult, 'down');
    const alerts = AlertSetting.findByWebsiteId(website.id);
    
    for (const alert of alerts) {
      try {
        switch (alert.alert_type) {
          case 'email':
            await this.sendEmail(website, checkResult, 'down', alert.config);
            break;
          case 'discord':
            await this.sendDiscord(website, checkResult, 'down', alert.config);
            break;
          case 'slack':
            await this.sendSlack(website, checkResult, 'down', alert.config);
            break;
          case 'webhook':
            await this.sendWebhook(website, checkResult, 'down', alert.config);
            break;
        }
      } catch (error) {
        console.error(`Failed to send ${alert.alert_type} alert:`, error.message);
      }
    }
  }

  static async sendUpAlert(website, checkResult, downtimeSeconds) {
    await this.sendLarkAlert(website, checkResult, 'up', downtimeSeconds);
    const alerts = AlertSetting.findByWebsiteId(website.id);
    
    for (const alert of alerts) {
      try {
        switch (alert.alert_type) {
          case 'email':
            await this.sendEmail(website, checkResult, 'up', alert.config, downtimeSeconds);
            break;
          case 'discord':
            await this.sendDiscord(website, checkResult, 'up', alert.config, downtimeSeconds);
            break;
          case 'slack':
            await this.sendSlack(website, checkResult, 'up', alert.config, downtimeSeconds);
            break;
          case 'webhook':
            await this.sendWebhook(website, checkResult, 'up', alert.config, downtimeSeconds);
            break;
        }
      } catch (error) {
        console.error(`Failed to send ${alert.alert_type} alert:`, error.message);
      }
    }
  }

  static async sendLarkAlert(website, checkResult, type, downtimeSeconds = null) {
    const webhookUrl = process.env.Lark_URL_API;
    if (!webhookUrl) return false;

    const isDown = type === 'down';
    const checkedAt = new Intl.DateTimeFormat('th-TH', {
      dateStyle: 'medium',
      timeStyle: 'medium',
      timeZone: 'Asia/Bangkok'
    }).format(new Date());
    const lines = isDown
      ? [
          '🔴 เว็บไซต์ขัดข้อง',
          `เว็บไซต์: ${website.name}`,
          `URL: ${website.url}`,
          'สถานะ: OFFLINE',
          `HTTP Status: ${checkResult.status_code || 'N/A'}`,
          `สาเหตุ: ${checkResult.error_message || 'ไม่ทราบสาเหตุ'}`,
          `เวลา: ${checkedAt}`
        ]
      : [
          '🟢 เว็บไซต์กลับมาใช้งานได้',
          `เว็บไซต์: ${website.name}`,
          `URL: ${website.url}`,
          'สถานะ: ONLINE',
          `HTTP Status: ${checkResult.status_code || 'N/A'}`,
          `เวลาตอบสนอง: ${checkResult.response_time ?? 'N/A'}ms`,
          `ระยะเวลาที่ขัดข้อง: ${this.formatDuration(downtimeSeconds || 0)}`,
          `เวลา: ${checkedAt}`
        ];

    try {
      const response = await axios.post(webhookUrl, {
        msg_type: 'text',
        content: { text: lines.join('\n') }
      }, {
        timeout: 10000,
        headers: { 'Content-Type': 'application/json' }
      });

      if (response.data && response.data.code !== undefined && Number(response.data.code) !== 0) {
        throw new Error('Lark API returned an error');
      }

      console.log(`Lark alert sent for ${website.name}`);
      return true;
    } catch (error) {
      console.error(`Failed to send Lark alert for ${website.name}: request failed`);
      return false;
    }
  }

  static async sendEmail(website, checkResult, type, config, downtimeSeconds = null) {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: process.env.SMTP_PORT,
      secure: process.env.SMTP_PORT === '465',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });

    const isDown = type === 'down';
    const emoji = isDown ? '🔴' : '🟢';
    const status = isDown ? 'OFFLINE' : 'ONLINE';
    
    let subject = `${emoji} [${status}] ${website.name} - Website Monitor Alert`;
    let html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: ${isDown ? '#dc3545' : '#28a745'}; color: white; padding: 20px; text-align: center;">
          <h1 style="margin: 0;">${emoji} Website ${status}</h1>
        </div>
        <div style="padding: 20px; background: #f8f9fa;">
          <h2 style="color: #333;">${website.name}</h2>
          <p><strong>URL:</strong> <a href="${website.url}">${website.url}</a></p>
          <p><strong>Status:</strong> ${status}</p>
          ${isDown ? `
            <p><strong>Error:</strong> ${checkResult.error_message || 'Unknown error'}</p>
            <p><strong>Status Code:</strong> ${checkResult.status_code || 'N/A'}</p>
          ` : `
            <p><strong>Response Time:</strong> ${checkResult.response_time}ms</p>
            ${downtimeSeconds ? `<p><strong>Downtime Duration:</strong> ${this.formatDuration(downtimeSeconds)}</p>` : ''}
          `}
          <p><strong>Checked At:</strong> ${new Date().toISOString()}</p>
        </div>
        <div style="padding: 10px; background: #e9ecef; text-align: center; color: #666;">
          <small>Website Uptime Monitor</small>
        </div>
      </div>
    `;

    await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: config.recipients.join(', '),
      subject,
      html
    });

    console.log(`📧 Email alert sent to: ${config.recipients.join(', ')}`);
  }

  static async sendDiscord(website, checkResult, type, config, downtimeSeconds = null) {
    const webhookUrl = config.webhook_url || process.env.DISCORD_WEBHOOK_URL;
    if (!webhookUrl) return;

    const isDown = type === 'down';
    const color = isDown ? 15158332 : 3066993; // Red or Green
    const emoji = isDown ? '🔴' : '🟢';
    const status = isDown ? 'OFFLINE' : 'ONLINE';

    const embed = {
      title: `${emoji} ${website.name} is ${status}`,
      color,
      fields: [
        { name: 'URL', value: website.url, inline: false },
        { name: 'Status', value: status, inline: true }
      ],
      timestamp: new Date().toISOString()
    };

    if (isDown) {
      embed.fields.push({ name: 'Error', value: checkResult.error_message || 'Unknown', inline: true });
    } else {
      embed.fields.push({ name: 'Response Time', value: `${checkResult.response_time}ms`, inline: true });
      if (downtimeSeconds) {
        embed.fields.push({ name: 'Downtime', value: this.formatDuration(downtimeSeconds), inline: true });
      }
    }

    await axios.post(webhookUrl, { embeds: [embed] });
    console.log(`💬 Discord alert sent`);
  }

  static async sendSlack(website, checkResult, type, config, downtimeSeconds = null) {
    const webhookUrl = config.webhook_url || process.env.SLACK_WEBHOOK_URL;
    if (!webhookUrl) return;

    const isDown = type === 'down';
    const emoji = isDown ? ':red_circle:' : ':large_green_circle:';
    const status = isDown ? 'OFFLINE' : 'ONLINE';
    const color = isDown ? 'danger' : 'good';

    const payload = {
      attachments: [{
        color,
        blocks: [
          {
            type: 'header',
            text: {
              type: 'plain_text',
              text: `${emoji} ${website.name} is ${status}`,
              emoji: true
            }
          },
          {
            type: 'section',
            fields: [
              { type: 'mrkdwn', text: `*URL:*\n${website.url}` },
              { type: 'mrkdwn', text: `*Status:*\n${status}` },
              isDown
                ? { type: 'mrkdwn', text: `*Error:*\n${checkResult.error_message || 'Unknown'}` }
                : { type: 'mrkdwn', text: `*Response Time:*\n${checkResult.response_time}ms` }
            ]
          }
        ]
      }]
    };

    if (!isDown && downtimeSeconds) {
      payload.attachments[0].blocks[1].fields.push({
        type: 'mrkdwn',
        text: `*Downtime:*\n${this.formatDuration(downtimeSeconds)}`
      });
    }

    await axios.post(webhookUrl, payload);
    console.log(`📢 Slack alert sent`);
  }

  static async sendWebhook(website, checkResult, type, config, downtimeSeconds = null) {
    const webhookUrl = config.webhook_url;
    if (!webhookUrl) return;

    const payload = {
      event: type === 'down' ? 'website.down' : 'website.up',
      website: {
        id: website.id,
        name: website.name,
        url: website.url
      },
      check: {
        status: checkResult.status,
        status_code: checkResult.status_code,
        response_time: checkResult.response_time,
        error_message: checkResult.error_message
      },
      downtime_seconds: downtimeSeconds,
      timestamp: new Date().toISOString()
    };

    await axios.post(webhookUrl, payload, {
      headers: {
        'Content-Type': 'application/json',
        ...(config.headers || {})
      }
    });
    console.log(`🌐 Webhook alert sent to: ${webhookUrl}`);
  }

  static formatDuration(seconds) {
    if (seconds < 60) return `${seconds} seconds`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)} minutes ${seconds % 60} seconds`;
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours} hours ${minutes} minutes`;
  }
}

module.exports = NotificationService;
