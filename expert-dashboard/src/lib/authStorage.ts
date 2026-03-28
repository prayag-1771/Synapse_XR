import type { User } from "./api";

const AUTH_STORAGE_KEY = "synapse_xr_expert_auth";

export interface StoredAuth {
  token: string;
  user: User;
}

export const readAuth = (): StoredAuth | null => {
  if (typeof window === "undefined") {
    return null;
  }

  const rawValue = window.localStorage.getItem(AUTH_STORAGE_KEY);
  if (!rawValue) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawValue) as Partial<StoredAuth>;
    if (typeof parsed.token !== "string" || !parsed.user) {
      return null;
    }

    return {
      token: parsed.token,
      user: parsed.user as User
    };
  } catch {
    return null;
  }
};

export const writeAuth = (auth: StoredAuth): void => {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(auth));
};

export const clearAuth = (): void => {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(AUTH_STORAGE_KEY);
};
