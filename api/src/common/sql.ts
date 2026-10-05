/** Anything with a `.query()`: a DataSource, an EntityManager or a QueryRunner. */
export interface Queryable {
  query(sql: string, params?: unknown[]): Promise<unknown>;
}

/**
 * Run an `UPDATE ... RETURNING ...` and get the changed rows back.
 *
 * TypeORM's `query()` returns the rows for SELECT and INSERT, but for UPDATE and
 * DELETE it returns a `[rows, affectedCount]` tuple. Checking `.length === 0`
 * on that tuple is always false, which silently disables any "did anything
 * change?" test (optimistic locking, in particular). Wrapping the statement in
 * a data-modifying CTE makes Postgres return an ordinary result set.
 */
export async function updateReturning<T = Record<string, unknown>>(
  db: Queryable,
  updateSql: string,
  params: unknown[] = [],
): Promise<T[]> {
  return (await db.query(`WITH changed AS (${updateSql}) SELECT * FROM changed`, params)) as T[];
}
