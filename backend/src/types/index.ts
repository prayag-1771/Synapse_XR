export interface User {
  id: string;
  email: string;
  password: string;
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

export interface JwtPayload {
  userId: string;
  email: string;
}
