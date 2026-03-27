import { randomUUID } from "node:crypto";
import { User } from "../types";

class UsersStore {
  private usersById = new Map<string, User>();
  private usersByEmail = new Map<string, User>();

  create(email: string, password: string): User {
    const normalizedEmail = email.toLowerCase().trim();
    if (this.usersByEmail.has(normalizedEmail)) {
      throw new Error("User already exists");
    }

    const user: User = {
      id: randomUUID(),
      email: normalizedEmail,
      password,
      createdAt: new Date().toISOString()
    };

    this.usersById.set(user.id, user);
    this.usersByEmail.set(user.email, user);

    return user;
  }

  findByEmail(email: string): User | undefined {
    return this.usersByEmail.get(email.toLowerCase().trim());
  }

  findById(id: string): User | undefined {
    return this.usersById.get(id);
  }
}

export const usersStore = new UsersStore();
