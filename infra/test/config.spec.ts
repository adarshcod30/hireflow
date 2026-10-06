import { App } from 'aws-cdk-lib';
import { DEFAULT_CONFIG, readConfig } from '../lib/config';

describe('readConfig', () => {
  it('returns the defaults when nothing is set', () => {
    expect(readConfig(new App().node)).toEqual(DEFAULT_CONFIG);
  });

  it('lets cdk context override a value, and converts the budget to a number', () => {
    const app = new App({ context: { apiDomain: 'api.example.org', monthlyBudgetUsd: '75' } });
    const config = readConfig(app.node);
    expect(config.apiDomain).toBe('api.example.org');
    expect(config.monthlyBudgetUsd).toBe(75);
    expect(config.senderEmail).toBe(DEFAULT_CONFIG.senderEmail);
  });

  it('ignores an empty override rather than blanking the setting', () => {
    const app = new App({ context: { alertEmail: '' } });
    expect(readConfig(app.node).alertEmail).toBe(DEFAULT_CONFIG.alertEmail);
  });
});
