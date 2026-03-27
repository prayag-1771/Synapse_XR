import { Router } from "express";
import { authMiddleware } from "../middleware/auth";
import { authService } from "../services/authService";
import { logger } from "../services/logger";
import { usersStore } from "../store/usersStore";

const router = Router();

router.post("/register", (req, res) => {
  const { email, password } = req.body as { email?: string; password?: string };

  if (!email || !password) {
    res.status(400).json({ error: "email and password are required" });
    return;
  }

  if (password.length < 6) {
    res.status(400).json({ error: "password must be at least 6 characters" });
    return;
  }

  try {
    const hashedPassword = authService.hashPassword(password);
    const user = usersStore.create(email, hashedPassword);
    const token = authService.generateToken({ userId: user.id, email: user.email });

    logger.info("auth_register_success", {
      userId: user.id,
      email: user.email
    });

    res.status(201).json({
      token,
      user: {
        id: user.id,
        email: user.email,
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

router.post("/login", (req, res) => {
  const { email, password } = req.body as { email?: string; password?: string };

  if (!email || !password) {
    res.status(400).json({ error: "email and password are required" });
    return;
  }

  const user = usersStore.findByEmail(email);

  if (!user || !authService.comparePassword(password, user.password)) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  const token = authService.generateToken({ userId: user.id, email: user.email });

  res.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      createdAt: user.createdAt
    }
  });
});

router.get("/me", authMiddleware, (req, res) => {
  const userId = req.user?.userId;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const user = usersStore.findById(userId);
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  res.json({
    user: {
      id: user.id,
      email: user.email,
      createdAt: user.createdAt
    }
  });
});

export default router;
