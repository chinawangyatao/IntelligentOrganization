import type { Api, Connection } from './types';

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
  }
}
export function createApi(connection: Connection): Api {
  return async <T>(path: string, method = 'GET', body?: unknown): Promise<T> => {
    let response: Response;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 20000);
    try {
      response = await fetch(`${connection.baseUrl.replace(/\/$/, '')}${path}`, {
        method,
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${connection.token}`,
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new ApiError('无法连接协同服务，请检查服务地址和网络连接。', 0);
    } finally {
      window.clearTimeout(timer);
    }
    const text = await response.text();
    let result: any;
    try {
      result = text ? JSON.parse(text) : undefined;
    } catch {
      throw new ApiError('服务返回了无法识别的数据。', response.status);
    }
    if (!response.ok)
      throw new ApiError(
        result?.error || `请求失败（${response.status}）`,
        response.status,
        result?.code,
      );
    return result as T;
  };
}
const isNative = () => '__TAURI_INTERNALS__' in window;
export async function loadConnection(): Promise<Connection | null> {
  if (isNative()) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<Connection | null>('connection_load');
  }
  const raw = sessionStorage.getItem('io.connection');
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
export async function saveConnection(connection: Connection): Promise<void> {
  if (isNative()) {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('connection_save', { connection });
  } else {
    sessionStorage.setItem('io.connection', JSON.stringify(connection));
  }
}
export async function clearConnection(): Promise<void> {
  if (isNative()) {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('connection_clear');
  } else {
    sessionStorage.removeItem('io.connection');
  }
}
