// Supabase Vault access, restricted to service_role.
//
// Vault's decrypted view is not exposed to PostgREST, so we go through two
// SECURITY DEFINER helpers defined in the migration:
//   public.get_secret(p_name)          -> text
//   public.upsert_secret(p_name, p_secret) -> uuid
// Both are granted to service_role only.

// deno-lint-ignore no-explicit-any
type Client = any;

import type { GoogleSecrets } from "./google.ts";

export async function readGoogleSecrets(client: Client): Promise<GoogleSecrets> {
  const [clientId, clientSecret, refreshToken] = await Promise.all([
    getSecret(client, "google_client_id"),
    getSecret(client, "google_client_secret"),
    getSecret(client, "google_refresh_token"),
  ]);

  const missing = [
    ["google_client_id", clientId],
    ["google_client_secret", clientSecret],
    ["google_refresh_token", refreshToken],
  ].filter(([, v]) => !v).map(([k]) => k);

  if (missing.length) {
    throw new Error(`Vault secrets ausentes: ${missing.join(", ")}`);
  }

  return { clientId: clientId!, clientSecret: clientSecret!, refreshToken: refreshToken! };
}

async function getSecret(client: Client, name: string): Promise<string | null> {
  const { data, error } = await client.rpc("get_secret", { p_name: name });
  if (error) throw new Error(`get_secret(${name}) falhou: ${error.message}`);
  return (data as string | null) ?? null;
}

export async function writeSecret(client: Client, name: string, value: string): Promise<void> {
  const { error } = await client.rpc("upsert_secret", { p_name: name, p_secret: value });
  if (error) throw new Error(`upsert_secret(${name}) falhou: ${error.message}`);
}
