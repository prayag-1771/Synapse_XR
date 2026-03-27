export type UserRole = "worker" | "expert" | "admin";

export interface User {
  id: string;
  email: string;
  role: UserRole;
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

interface SessionsResponse {
  sessions: Session[];
}

interface MeResponse {
  user: User;
}

interface LatestGloveResponse {
  latest: Record<string, unknown> | null;
}

interface HealthResponse {
  status: string;
  service: string;
}

interface UsersResponse {
  users: User[];
}

interface AdminSessionsResponse {
  sessions: Session[];
}

export const backendHttpBaseUrl = (process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:3000").replace(/\/$/, "");
export const backendWsBaseUrl = (process.env.NEXT_PUBLIC_BACKEND_WS_URL ?? backendHttpBaseUrl).replace(/\/$/, "");

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH";
  token?: string;
  body?: Record<string, unknown>;
}

const apiRequest = async <T>(path: string, options: RequestOptions = {}): Promise<T> => {
  const { method = "GET", token, body } = options;

  const response = await fetch(`${backendHttpBaseUrl}${path}`, {
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
  register: (email: string, password: string, role: Exclude<UserRole, "admin">): Promise<AuthResponse> =>
    apiRequest<AuthResponse>("/auth/register", {
      method: "POST",
      body: { email, password, role }
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

  listOpenSessions: (token: string): Promise<SessionsResponse> =>
    apiRequest<SessionsResponse>("/sessions/open", {
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

  health: (): Promise<HealthResponse> =>
    apiRequest<HealthResponse>("/health"),

  getLatestGlove: (sessionId: string, token: string): Promise<LatestGloveResponse> =>
    apiRequest<LatestGloveResponse>(`/sessions/${sessionId}/glove/latest`, {
      token
    }),

  // Admin endpoints
  listUsers: (token: string): Promise<UsersResponse> =>
    apiRequest<UsersResponse>("/admin/users", {
      token
    }),

  updateUserRole: (userId: string, role: UserRole, token: string): Promise<{ user: User }> =>
    apiRequest<{ user: User }>(`/admin/users/${userId}/role`, {
      method: "PATCH",
      token,
      body: { role }
    }),

  listAdminSessions: (token: string, status?: "active" | "ended"): Promise<AdminSessionsResponse> =>
    apiRequest<AdminSessionsResponse>(`/admin/sessions${status ? `?status=${status}` : ""}`, {
      token
    }),

  forceEndSession: (sessionId: string, token: string): Promise<SessionResponse> =>
    apiRequest<SessionResponse>(`/admin/sessions/${sessionId}/end`, {
      method: "POST",
      token
    })
};
