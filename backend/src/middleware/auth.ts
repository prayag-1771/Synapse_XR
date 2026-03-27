import { NextFunction, Request, Response } from "express";
import { authService } from "../services/authService";

export const authMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing or invalid Authorization header" });
    return;
  }

  const token = authHeader.slice("Bearer ".length);

  try {
    const payload = authService.verifyToken(token);
    req.user = {
      userId: payload.userId,
      email: payload.email
    };
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
};
