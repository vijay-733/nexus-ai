import type { HealthReport } from './healthMonitor.js';

export type AlertChannel = 'console' | 'webhook' | 'event';

export interface AlertConfig {
  channels: AlertChannel[];
  webhookUrl?: string;
  minSeverity: 'degraded' | 'critical';
}

export class AlertSystem {
  private config: AlertConfig = {
    channels: ['console'],
    minSeverity: 'degraded',
  };

  configure(patch: Partial<AlertConfig>): void {
    Object.assign(this.config, patch);
  }

  async notify(report: HealthReport): Promise<void> {
    if (report.status === 'healthy') return;
    if (report.status === 'degraded' && this.config.minSeverity === 'critical') return;

    const failingChecks = Object.entries(report.checks)
      .filter(([, v]) => v.status !== 'healthy')
      .map(([k, v]) => `${k}: ${v.message}`)
      .join(' | ');

    const message = `[NEXUS HEALTH] ${report.status.toUpperCase()} — ${failingChecks}`;

    for (const channel of this.config.channels) {
      if (channel === 'console') {
        console.error(message);
      } else if (channel === 'webhook' && this.config.webhookUrl) {
        await this.postWebhook(this.config.webhookUrl, { message, report }).catch(err =>
          console.error('[AlertSystem] Webhook failed:', err)
        );
      }
    }
  }

  private async postWebhook(url: string, body: unknown): Promise<void> {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Webhook ${url} returned ${res.status}`);
  }
}

export const alertSystem = new AlertSystem();
