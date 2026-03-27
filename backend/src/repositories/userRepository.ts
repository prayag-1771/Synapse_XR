import { randomUUID } from "node:crypto";
import { pgQuery } from "../db/postgres";
import { User } from "../types";

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  created_at: string;
}

const mapUserRow = (row: UserRow): User => {
  return {
    id: row.id,
    email: row.email,
    password: row.password_hash,
    createdAt: row.created_at
  };
};

const create = async (email: string, passwordHash: string): Promise<User> => {
  const id = randomUUID();
  const normalizedEmail = email.toLowerCase().trim();

  try {
    const { rows } = await pgQuery<UserRow>(
      `
      INSERT INTO users (id, email, password_hash)
      VALUES ($1, $2, $3)
      RETURNING id, email, password_hash, created_at
      `,
      [id, normalizedEmail, passwordHash]
    );

    return mapUserRow(rows[0]);
  } catch (error) {
    const pgError = error as { code?: string };
    if (pgError.code === "23505") {
      throw new Error("User already exists");
    }
    throw error;
  }
};

const findByEmail = async (email: string): Promise<User | null> => {
  const normalizedEmail = email.toLowerCase().trim();
  const { rows } = await pgQuery<UserRow>(
    `
    SELECT id, email, password_hash, created_at
    FROM users
    WHERE email = $1
    LIMIT 1
    `,
    [normalizedEmail]
  );

  if (rows.length === 0) {
    return null;
  }

  return mapUserRow(rows[0]);
};

const findById = async (id: string): Promise<User | null> => {
  const { rows } = await pgQuery<UserRow>(
    `
    SELECT id, email, password_hash, created_at
    FROM users
    WHERE id = $1
    LIMIT 1
    `,
    [id]
  );

  if (rows.length === 0) {
    return null;
  }

  return mapUserRow(rows[0]);
};

export const userRepository = {
  create,
  findByEmail,
  findById
};
