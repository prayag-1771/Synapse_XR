type LogMeta = Record<string, unknown>;

const formatMeta = (meta?: LogMeta): string => {
  if (!meta || Object.keys(meta).length === 0) {
    return "";
  }

  return ` ${JSON.stringify(meta)}`;
};

const log = (level: "INFO" | "WARN" | "ERROR", event: string, meta?: LogMeta): void => {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] [${level}] ${event}${formatMeta(meta)}`;

  if (level === "ERROR") {
    console.error(line);
    return;
  }

  if (level === "WARN") {
    console.warn(line);
    return;
  }

  console.log(line);
};

export const logger = {
  info: (event: string, meta?: LogMeta) => log("INFO", event, meta),
  warn: (event: string, meta?: LogMeta) => log("WARN", event, meta),
  error: (event: string, meta?: LogMeta) => log("ERROR", event, meta)
};
