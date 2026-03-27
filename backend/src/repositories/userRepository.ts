import { randomUUID } from "node:crypto";
import { pgQuery } from "../db/postgres";
import { User, UserRole } from "../types";

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  role: UserRole;
  created_at: string;
}

const mapUserRow = (row: UserRow): User => {
  return {
    id: row.id,
    email: row.email,
    password: row.password_hash,
    role: row.role,
    createdAt: row.created_at
  };
};

const create = async (email: string, passwordHash: string, role: UserRole): Promise<User> => {
  const id = randomUUID();
  const normalizedEmail = email.toLowerCase().trim();

  try {
    const { rows } = await pgQuery<UserRow>(
      `
      INSERT INTO users (id, email, password_hash, role)
      VALUES ($1, $2, $3, $4)
      RETURNING id, email, password_hash, role, created_at
      `,
      [id, normalizedEmail, passwordHash, role]
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
    SELECT id, email, password_hash, role, created_at
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
    SELECT id, email, password_hash, role, created_at
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

const listAll = async (): Promise<User[]> => {
  const { rows } = await pgQuery<UserRow>(
    `
    SELECT id, email, password_hash, role, created_at
    FROM users
    ORDER BY created_at DESC
    `
  );

  return rows.map(mapUserRow);
};

const updateRole = async (id: string, role: UserRole): Promise<User | null> => {
  const { rows } = await pgQuery<UserRow>(
    `
    UPDATE users
    SET role = $2
    WHERE id = $1
    RETURNING id, email, password_hash, role, created_at
    `,
    [id, role]
  );

  if (rows.length === 0) {
    return null;
  }

  return mapUserRow(rows[0]);
};

export const userRepository = {
  create,
  findByEmail,
  findById,
  listAll,
  updateRole
};
