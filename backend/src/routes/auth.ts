import { Router } from "express";
import { authMiddleware } from "../middleware/auth";
import { authService } from "../services/authService";
import { logger } from "../services/logger";
import { userRepository } from "../repositories/userRepository";
import { UserRole } from "../types";

const router = Router();
const REGISTERABLE_ROLES: UserRole[] = ["worker", "expert"];

router.post("/register", async (req, res) => {
  const { email, password, role } = req.body as { email?: string; password?: string; role?: string };

  if (!email || !password) {
    res.status(400).json({ error: "email and password are required" });
    return;
  }

  const normalizedRole = (role ?? "worker").toLowerCase() as UserRole;
  if (!REGISTERABLE_ROLES.includes(normalizedRole)) {
    res.status(400).json({ error: "role must be one of: worker, expert" });
    return;
  }

  if (password.length < 6) {
    res.status(400).json({ error: "password must be at least 6 characters" });
    return;
  }

  try {
    const hashedPassword = authService.hashPassword(password);
    const user = await userRepository.create(email, hashedPassword, normalizedRole);
    const token = authService.generateToken({ userId: user.id, email: user.email, role: user.role });

    logger.info("auth_register_success", {
      userId: user.id,
      email: user.email,
      role: user.role
    });

    res.status(201).json({
      token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        createdAt: user.createdAt
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Registration failed";
    logger.warn("auth_register_failed", {
      email: email?.toLowerCase().trim(),
      reason: message
    });
    res.status(409).json({ error: message });
  }
});

router.post("/login", async (req, res) => {
  const { email, password } = req.body as { email?: string; password?: string };

  if (!email || !password) {
    res.status(400).json({ error: "email and password are required" });
    return;
  }

  const user = await userRepository.findByEmail(email);

  if (!user || !authService.comparePassword(password, user.password)) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  const token = authService.generateToken({ userId: user.id, email: user.email, role: user.role });

  res.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      createdAt: user.createdAt
    }
  });
});

router.get("/me", authMiddleware, async (req, res) => {
  const userId = req.user?.userId;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const user = await userRepository.findById(userId);
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  res.json({
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      createdAt: user.createdAt
    }
  });
});

export default router;
