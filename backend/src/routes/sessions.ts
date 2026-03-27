import { Router } from "express";
import { authMiddleware } from "../middleware/auth";
import { sessionRepository } from "../repositories/sessionRepository";
import { getLatestGloveState } from "../db/redis";
import { logger } from "../services/logger";

const router = Router();

router.post("/", authMiddleware, async (req, res) => {
  const userId = req.user?.userId;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const session = await sessionRepository.create(userId);
  logger.info("session_created", {
    sessionId: session.id,
    createdBy: userId
  });
  res.status(201).json({ session });
});

router.get("/:id", authMiddleware, async (req, res) => {
  const userId = req.user?.userId;
  const sessionId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const session = await sessionRepository.findById(sessionId);
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  const canAccess = session.participants.includes(userId) || session.createdBy === userId;
  if (!canAccess) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  res.json({ session });
});

router.get("/:id/glove/latest", authMiddleware, async (req, res) => {
  const userId = req.user?.userId;
  const sessionId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const session = await sessionRepository.findById(sessionId);
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  const canAccess = session.participants.includes(userId) || session.createdBy === userId;
  if (!canAccess) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const latest = await getLatestGloveState<Record<string, unknown>>(sessionId);
  res.json({ latest });
});

router.post("/:id/join", authMiddleware, async (req, res) => {
  const userId = req.user?.userId;
  const sessionId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const session = await sessionRepository.addParticipant(sessionId, userId);
    logger.info("session_joined", {
      sessionId,
      userId,
      participantCount: session.participants.length
    });
    res.json({ session });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to join session";
    logger.warn("session_join_failed", {
      sessionId,
      userId,
      reason: message
    });
    const status = message.includes("not found") ? 404 : 400;
    res.status(status).json({ error: message });
  }
});

router.post("/:id/leave", authMiddleware, async (req, res) => {
  const userId = req.user?.userId;
  const sessionId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const session = await sessionRepository.removeParticipant(sessionId, userId);
    logger.info("session_left", {
      sessionId,
      userId,
      participantCount: session.participants.length
    });
    res.json({ session });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to leave session";
    logger.warn("session_leave_failed", {
      sessionId,
      userId,
      reason: message
    });
    const status = message.includes("not found") ? 404 : 400;
    res.status(status).json({ error: message });
  }
});

router.post("/:id/end", authMiddleware, async (req, res) => {
  const userId = req.user?.userId;
  const sessionId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const session = await sessionRepository.end(sessionId, userId);
    logger.info("session_deleted", {
      sessionId,
      deletedBy: userId,
      endedAt: session.endedAt
    });
    res.json({ session });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to end session";
    logger.warn("session_delete_failed", {
      sessionId,
      userId,
      reason: message
    });
    const status = message.includes("not found") ? 404 : 403;
    res.status(status).json({ error: message });
  }
});

export default router;
