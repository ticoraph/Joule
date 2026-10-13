import { auth } from "../lib/firebase";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

export async function api<T = unknown>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
  };
  if (!(options.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }

  const token = await auth?.currentUser?.getIdToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${API_URL}/api${path}`, { ...options, headers });
  if (res.status === 401 || res.status === 403) {
    await auth?.signOut();
    throw new Error(`${res.status}: not authorized`);
  }
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`${res.status}: ${detail}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export { API_URL };
