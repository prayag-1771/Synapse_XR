import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { JwtPayload } from "../types";

const KEY_LENGTH = 64;

const hashPassword = (password: string): string => {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, KEY_LENGTH).toString("hex");
  return `${salt}:${hash}`;
};

const comparePassword = (password: string, storedValue: string): boolean => {
  const [salt, storedHash] = storedValue.split(":");
  if (!salt || !storedHash) {
    return false;
  }

  const hashBuffer = scryptSync(password, salt, KEY_LENGTH);
  const storedHashBuffer = Buffer.from(storedHash, "hex");

  if (hashBuffer.length !== storedHashBuffer.length) {
    return false;
  }

  return timingSafeEqual(hashBuffer, storedHashBuffer);
};

const generateToken = (payload: JwtPayload): string => {
  return jwt.sign(payload, env.jwtSecret, { expiresIn: "12h" });
};

const verifyToken = (token: string): JwtPayload => {
  return jwt.verify(token, env.jwtSecret) as JwtPayload;
};

export const authService = {
  hashPassword,
  comparePassword,
  generateToken,
  verifyToken
};
