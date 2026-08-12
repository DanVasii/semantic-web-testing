import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { createConnection } from "mysql2/promise";

const option = (name, fallback) => {
  const prefix = `--${name}=`;
  const argument = process.argv
    .slice(2)
    .find((value) => value.startsWith(prefix));
  return argument === undefined ? fallback : argument.slice(prefix.length);
};

const host = option("host", "127.0.0.1");
const port = Number(option("port", "3306"));
const user = option("root-user", "root");
const password = option("root-password", "");

if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("Portul MySQL pentru fixture nu este valid.");
}

const schemaPath = resolve("fixtures/mysql/schema.sql");
const sql = await readFile(schemaPath, "utf8");
const connection = await createConnection({
  host,
  port,
  user,
  password,
  multipleStatements: true,
});

try {
  await connection.query(sql);
  process.stdout.write(
    [
      "MySQL fixture configured.",
      `Server: ${host}:${port}`,
      "Database: semantic_fixture",
      "Application user: root",
      "Application password: (empty)",
      "",
    ].join("\n"),
  );
} finally {
  await connection.end();
}
