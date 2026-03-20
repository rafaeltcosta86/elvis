import axios, { AxiosInstance } from 'axios';
import { getToken } from './oauthService';

/**
 * Creates an axios instance configured for Microsoft Graph API calls.
 * Automatically injects the Authorization header with the stored token.
 */
export async function createGraphClient(): Promise<AxiosInstance> {
  const accessToken = await getToken();

  if (!accessToken) {
    throw new Error('No Microsoft OAuth token found. Run the OAuth bootstrap script first.');
  }

  return axios.create({
    baseURL: 'https://graph.microsoft.com/v1.0',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  });
}

/**
 * Helper to make a GET request to Microsoft Graph.
 */
export async function graphGet(endpoint: string): Promise<any> {
  const client = await createGraphClient();
  return client.get(endpoint);
}

/**
 * Helper to make a POST request to Microsoft Graph.
 */
export async function graphPost(endpoint: string, data: any): Promise<any> {
  const client = await createGraphClient();
  return client.post(endpoint, data);
}
