import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';

/** Returns the secret. Pass true to throw away the cached value and read it again. */
export type SecretReader = (forceRefresh?: boolean) => Promise<string>;

/** Read a secret once per container and reuse it, so a warm Lambda does not call Secrets Manager every time. */
export function cachedSecret(client: SecretsManagerClient, secretId: string): SecretReader {
  let cached: Promise<string> | undefined;
  return (forceRefresh = false) => {
    if (forceRefresh) cached = undefined;
    cached ??= client.send(new GetSecretValueCommand({ SecretId: secretId })).then((out) => {
      if (!out.SecretString) throw new Error(`Secret ${secretId} has no string value`);
      return out.SecretString;
    });
    // Do not keep a failed read: the next invocation should try again
    cached.catch(() => {
      cached = undefined;
    });
    return cached;
  };
}

export function requireEnv(name: string, env: NodeJS.ProcessEnv = process.env): string {
  const value = env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}
