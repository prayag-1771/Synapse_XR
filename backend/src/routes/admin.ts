import { Router } from "express";
import { authMiddleware } from "../middleware/auth";
import { userRepository } from "../repositories/userRepository";
import { sessionRepository } from "../repositories/sessionRepository";
import { logger } from "../services/logger";
import { UserRole } from "../types";

const router = Router();
const ALL_ROLES: UserRole[] = ["worker", "expert", "admin"];
const SESSION_STATUSES = new Set(["active", "ended"]);

const ensureAdmin = (role?: string): boolean => role === "admin";

router.use(authMiddleware);

router.use((req, res, next) => {
  if (!ensureAdmin(req.user?.role)) {
    res.status(403).json({ error: "Admin access required" });
    return;
  }

  next();
});

router.get("/users", async (_req, res) => {
  const users = await userRepository.listAll();

  res.json({
    users: users.map((user) => ({
      id: user.id,
      email: user.email,
      role: user.role,
      createdAt: user.createdAt
    }))
  });
});

router.patch("/users/:id/role", async (req, res) => {
  const actorId = req.user?.userId;
  const targetUserId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const nextRole = (req.body as { role?: string }).role?.toLowerCase() as UserRole | undefined;

  if (!nextRole || !ALL_ROLES.includes(nextRole)) {
    res.status(400).json({ error: "role must be one of: worker, expert, admin" });
    return;
  }

  if (actorId === targetUserId && nextRole !== "admin") {
    res.status(400).json({ error: "Admin cannot demote itself via this endpoint" });
    return;
  }

  const updatedUser = await userRepository.updateRole(targetUserId, nextRole);
  if (!updatedUser) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  logger.info("admin_user_role_updated", {
    actorId,
    targetUserId,
    role: nextRole
  });

  res.json({
    user: {
      id: updatedUser.id,
      email: updatedUser.email,
      role: updatedUser.role,
      createdAt: updatedUser.createdAt
    }
  });
});

router.get("/sessions", async (req, res) => {
  const status = (req.query.status as string | undefined)?.toLowerCase();

  if (status && !SESSION_STATUSES.has(status)) {
    res.status(400).json({ error: "status must be one of: active, ended" });
    return;
  }

  const sessions = await sessionRepository.listAll(status as "active" | "ended" | undefined);
  res.json({ sessions });
});

router.post("/sessions/:id/end", async (req, res) => {
  const actorId = req.user?.userId;
  const sessionId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

  try {
    const session = await sessionRepository.forceEnd(sessionId);

    logger.info("admin_session_force_ended", {
      actorId,
      sessionId,
      endedAt: session.endedAt
    });

    res.json({ session });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to end session";
    const statusCode = message.includes("not found") ? 404 : 400;
    res.status(statusCode).json({ error: message });
  }
});

export default router;
