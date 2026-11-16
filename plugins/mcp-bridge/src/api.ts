export interface Connection {
  baseUrl: string;
  token: string;
  host?: string;
  nativeSessionId?: string;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function validateBaseUrl(value: string): string {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash)
    throw new Error('Service URL must not contain credentials, query parameters or fragments');
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local))
    throw new Error('Use HTTPS for a remote service; HTTP is allowed only for localhost');
  return url.toString().replace(/\/$/, '');
}

export class OrganizationClient {
  readonly baseUrl: string;
  constructor(
    private readonly connection: Connection,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    this.baseUrl = validateBaseUrl(connection.baseUrl);
    if (!connection.token.trim()) throw new Error('IO_MEMBER_TOKEN is required');
  }
  async request(method: string, path: string, body?: unknown): Promise<unknown> {
    const response = await this.fetcher(`${this.baseUrl}/api${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.connection.token}`,
        ...(this.connection.nativeSessionId
          ? { 'X-IO-Thread-ID': this.connection.nativeSessionId }
          : {}),
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
      redirect: 'error',
    });
    const raw = await response.text();
    let value: unknown;
    try {
      value = raw ? JSON.parse(raw) : null;
    } catch {
      throw new ApiError(response.status, 'Service returned an invalid JSON response');
    }
    if (!response.ok) {
      const error = value as { error?: string; code?: string } | null;
      const message =
        typeof error?.error === 'string' ? error.error : `Request failed (${response.status})`;
      throw new ApiError(
        response.status,
        message.replaceAll(this.connection.token, '[redacted]'),
        error?.code,
      );
    }
    return value;
  }
}

export const segment = (value: string): string => encodeURIComponent(value);
export const projectPath = (projectId: string): string => `/projects/${segment(projectId)}`;
