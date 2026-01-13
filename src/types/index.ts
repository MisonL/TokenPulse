export interface TokenData {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
  id_token?: string;
  // Specific fields
  account_email?: string;
}

export interface ProviderConfig {
  clientId: string;
  clientSecret?: string;
  authUrl: string;
  tokenUrl: string;
  redirectUri: string;
  scopes: string[];
}
