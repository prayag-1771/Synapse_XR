export interface User {
  id: string;
  email: string;
  createdAt: string;
}

export interface Session {
  id: string;
  createdBy: string;
  status: "active" | "ended";
  participants: string[];
  createdAt: string;
  endedAt: string | null;
}

interface AuthResponse {
  token: string;
  user: User;
}

interface SessionResponse {
  session: Session;
}

interface MeResponse {
  user: User;
}

interface LatestGloveResponse {
  latest: Record<string, unknown> | null;
}

const baseUrl = (process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:3001").replace(/\/$/, "");

interface RequestOptions {
  method?: "GET" | "POST";
  token?: string;
  body?: Record<string, unknown>;
}

const apiRequest = async <T>(path: string, options: RequestOptions = {}): Promise<T> => {
  const { method = "GET", token, body } = options;

  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    cache: "no-store"
  });

  const text = await response.text();
  const payload = text ? (JSON.parse(text) as Record<string, unknown>) : {};

  if (!response.ok) {
    const message = typeof payload.error === "string" ? payload.error : `Request failed (${response.status})`;
    throw new Error(message);
  }

  return payload as T;
};

export const api = {
  register: (email: string, password: string): Promise<AuthResponse> =>
    apiRequest<AuthResponse>("/auth/register", {
      method: "POST",
      body: { email, password }
    }),

  login: (email: string, password: string): Promise<AuthResponse> =>
    apiRequest<AuthResponse>("/auth/login", {
      method: "POST",
      body: { email, password }
    }),

  me: (token: string): Promise<MeResponse> =>
    apiRequest<MeResponse>("/auth/me", {
      token
    }),

  createSession: (token: string): Promise<SessionResponse> =>
    apiRequest<SessionResponse>("/sessions", {
      method: "POST",
      token
    }),

  getSession: (sessionId: string, token: string): Promise<SessionResponse> =>
    apiRequest<SessionResponse>(`/sessions/${sessionId}`, {
      token
    }),

  joinSession: (sessionId: string, token: string): Promise<SessionResponse> =>
    apiRequest<SessionResponse>(`/sessions/${sessionId}/join`, {
      method: "POST",
      token
    }),

  leaveSession: (sessionId: string, token: string): Promise<SessionResponse> =>
    apiRequest<SessionResponse>(`/sessions/${sessionId}/leave`, {
      method: "POST",
      token
    }),

  endSession: (sessionId: string, token: string): Promise<SessionResponse> =>
    apiRequest<SessionResponse>(`/sessions/${sessionId}/end`, {
      method: "POST",
      token
    }),

  getLatestGlove: (sessionId: string, token: string): Promise<LatestGloveResponse> =>
    apiRequest<LatestGloveResponse>(`/sessions/${sessionId}/glove/latest`, {
      token
    })
};
