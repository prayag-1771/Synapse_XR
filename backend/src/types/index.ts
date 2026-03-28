export type UserRole = "worker" | "expert" | "admin";

export interface User {
  id: string;
  email: string;
  password: string;
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

export interface JwtPayload {
  userId: string;
  email: string;
  role: UserRole;
}
