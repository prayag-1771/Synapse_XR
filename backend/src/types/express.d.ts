declare namespace Express {
  interface Request {
    user?: {
      userId: string;
      email: string;
      role: "worker" | "expert" | "admin";
    };
  }
}
