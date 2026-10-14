/** Awaits an operation that must fail and returns the underlying PostgreSQL message (Drizzle wraps it in `cause`). */
export async function dbError(operation: Promise<unknown>): Promise<string> {
  try {
    await operation;
  } catch (error) {
    let e: unknown = error;
    while (e instanceof Error && e.cause) e = e.cause;
    return e instanceof Error ? e.message : String(e);
  }
  throw new Error('Expected the database to reject the operation, but it succeeded');
}
