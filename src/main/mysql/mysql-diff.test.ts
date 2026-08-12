import { describe, expect, it } from "vitest";

import type { MySqlTableSnapshot } from "../../shared/mysql.js";
import { compareMySqlTableSnapshots } from "./mysql-diff.js";

const table = (
  rows: MySqlTableSnapshot["rows"],
  identityColumns = ["tenant_id", "id"],
): MySqlTableSnapshot => ({
  tableName: "appointments",
  columns: ["tenant_id", "id", "status", "note"],
  identityColumns,
  rows,
});

describe("MySQL snapshot diff", () => {
  it("compares inserted, deleted and updated rows with composite AND identity", () => {
    const result = compareMySqlTableSnapshots(
      table([
        { tenant_id: 1, id: 10, status: "created", note: null },
        { tenant_id: 1, id: 20, status: "created", note: "old" },
        { tenant_id: 2, id: 10, status: "created", note: null },
      ]),
      table([
        { tenant_id: 1, id: 10, status: "confirmed", note: null },
        { tenant_id: 2, id: 10, status: "created", note: null },
        { tenant_id: 1, id: 30, status: "created", note: "new" },
      ]),
    );

    expect(result.inserted).toEqual([
      {
        identity: { tenant_id: 1, id: 30 },
        row: {
          tenant_id: 1,
          id: 30,
          status: "created",
          note: "new",
        },
      },
    ]);
    expect(result.deleted[0]?.identity).toEqual({ tenant_id: 1, id: 20 });
    expect(result.updated[0]).toMatchObject({
      identity: { tenant_id: 1, id: 10 },
      changedColumns: ["status"],
      before: { status: "created" },
      after: { status: "confirmed" },
    });
  });

  it("reports duplicate identities instead of matching rows arbitrarily", () => {
    const result = compareMySqlTableSnapshots(
      table(
        [
          { tenant_id: 1, id: 10, status: "a", note: null },
          { tenant_id: 1, id: 10, status: "b", note: null },
        ],
        ["tenant_id"],
      ),
      table([{ tenant_id: 1, id: 10, status: "c", note: null }], ["tenant_id"]),
    );

    expect(result.inserted).toHaveLength(0);
    expect(result.deleted).toHaveLength(0);
    expect(result.updated).toHaveLength(0);
    expect(result.duplicateIdentities).toHaveLength(1);
    expect(result.duplicateIdentities[0]?.beforeRows).toHaveLength(2);
  });
});
