import {
  createConnection,
  type ConnectionOptions,
  type RowDataPacket,
} from "mysql2/promise";

export interface ResolvedMySqlConnection {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  ssl: boolean;
}

export interface MySqlSession {
  query: (
    sql: string,
    values?: readonly unknown[],
  ) => Promise<Record<string, unknown>[]>;
  execute: (
    sql: string,
    values?: readonly unknown[],
  ) => Promise<{ affectedRows: number }>;
  beginTransaction: () => Promise<void>;
  commit: () => Promise<void>;
  rollback: () => Promise<void>;
  close: () => Promise<void>;
}

export interface MySqlGateway {
  connect: (config: ResolvedMySqlConnection) => Promise<MySqlSession>;
}

export const createMySqlGateway = (): MySqlGateway => ({
  async connect(config) {
    const options: ConnectionOptions = {
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.username,
      password: config.password,
      connectTimeout: 10_000,
      enableKeepAlive: false,
      supportBigNumbers: true,
      bigNumberStrings: true,
      dateStrings: true,
      ...(config.ssl ? { ssl: {} } : {}),
    };
    const connection = await createConnection(options);
    return {
      async query(sql, values = []) {
        const [rows] = await connection.query<RowDataPacket[]>(sql, [
          ...values,
        ]);
        return rows.map((row) => ({ ...row }));
      },
      async execute(sql, values = []) {
        const [result] = await connection.query(sql, [...values]);
        if (!("affectedRows" in result)) {
          throw new Error("Operația MySQL nu a returnat affectedRows.");
        }
        return { affectedRows: result.affectedRows };
      },
      beginTransaction: () => connection.beginTransaction(),
      commit: () => connection.commit(),
      rollback: () => connection.rollback(),
      close: () => connection.end(),
    };
  },
});
