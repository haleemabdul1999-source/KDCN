
const API = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';

/** Server-side fetch for public data (no user cookies are forwarded). */
export async function serverGet<T>(path: string, revalidateSeconds = 30): Promise<T | null> {
  try {
    const res = await fetch(`${API}/api${path}`, { next: { revalidate: revalidateSeconds } });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`API ${res.status}`);
    return (await res.json()) as T;
  } catch (e) {
    console.error(`serverGet ${path} failed`, e);
    throw e;
  }
}
