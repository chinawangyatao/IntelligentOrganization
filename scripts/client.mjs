import { loadEnv } from './env.mjs';
export const config = loadEnv();
export async function api(path, { token = config.token, method = 'GET', body, expected } = {}) {
  const response = await fetch(`${config.baseUrl}/api${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { error: text };
  }
  if (expected !== undefined) {
    if (response.status !== expected)
      throw new Error(
        `${method} ${path}: expected ${expected}, got ${response.status}: ${data.error || text}`,
      );
    return data;
  }
  if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${data.error || text}`);
  return data;
}
