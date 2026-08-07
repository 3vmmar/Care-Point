import { env } from "cloudflare:workers";
import { neon, types, type NeonQueryFunction } from "@neondatabase/serverless";

/**
 * The database handle every `db/*.ts` module talks to.
 *
 * ## Why this exists
 *
 * The data layer was written against Cloudflare D1: ~240 `prepare()` sites, 174
 * `bind()` calls and 32 `batch()` calls of hand-written SQL, with no ORM in the
 * request path. Moving to Postgres by rewriting all of that would have meant
 * re-proving the no-double-booking guarantee from scratch — the single most
 * safety-critical behaviour in the system — as a side effect of an
 * infrastructure change.
 *
 * So the engine changed underneath instead. This module presents the same
 * surface D1 did (`prepare().bind().run()/.all()`, plus `batch()`), over Neon
 * Postgres. The call sites, and the tests that hold them to account, stay as
 * they were.
 *
 * ## What it does NOT do
 *
 * It is a protocol shim, not a SQL translator. `INSERT OR IGNORE`, `strftime`,
 * `julianday` and integer-as-boolean comparisons are SQLite dialect and are
 * ported explicitly at each call site — deliberately, because silently
 * rewriting SQL would hide real dialect bugs behind a layer nobody reads.
 *
 * ## Transactions
 *
 * `batch()` maps onto Neon's non-interactive HTTP transaction, which is a close
 * match for `D1.batch()`: an array of statements, one round trip, all-or-
 * nothing. The occupancy-grid write in `db/bookings.ts` depends on that
 * atomicity — a racer that loses the primary-key collision must roll back its
 * appointment row too, not leave a booking holding no time.
 *
 * This is the one place the migration strengthens a guarantee rather than
 * preserving it: D1's `batch()` is an implicit transaction with no isolation
 * control, whereas this runs at an explicit `Serializable` level.
 */

/* -------------------------------------------------------------------------- */
/* Type parsers                                                               */
/* -------------------------------------------------------------------------- */

/**
 * The call sites read every value as a string, because SQLite had no date type
 * and no boolean. Postgres does, and its driver returns `Date` objects for
 * timestamps and `"17:30:00"` for times — so without these parsers, every
 * comparison in the data layer would rot quietly rather than fail loudly.
 *
 * Keep this in step with the type conventions documented in `db/schema.ts`.
 */
const TIMESTAMPTZ = 1184;
const TIMESTAMP = 1114;
const DATE = types.builtins.DATE; // 1082
const TIME = types.builtins.TIME; // 1083
const INT8 = types.builtins.INT8; // 20
const NUMERIC = types.builtins.NUMERIC; // 1700

/** Delegate to the driver's own timestamp parsing, then re-serialise as ISO-8601. */
function isoTimestampParser(oid: number) {
  const parse = types.getTypeParser(oid);
  return (value: string): string | null => {
    if (value === null) return null;
    const parsed = parse(value) as unknown;
    return parsed instanceof Date ? parsed.toISOString() : String(parsed);
  };
}

const customTypes = {
  getTypeParser(oid: number, format?: string): unknown {
    switch (oid) {
      case TIMESTAMPTZ:
      case TIMESTAMP:
        return isoTimestampParser(oid);
      /**
       * `date` and `time` are clinic wall-clock, not instants. The default
       * parser turns a `date` into a `Date` at UTC midnight, which is how a
       * Cairo appointment silently becomes the previous evening.
       */
      case DATE:
        return (value: string) => value;
      /** `"17:30:00"` → `"17:30"`. The whole codebase speaks `HH:mm`. */
      case TIME:
        return (value: string) => (value === null ? null : String(value).slice(0, 5));
      /**
       * `COUNT(*)` is `bigint`, which the driver returns as a *string*. Every
       * dashboard aggregate does arithmetic on these, and `"12" + 1` is `"121"`.
       */
      case INT8:
      case NUMERIC:
        return (value: string) => (value === null ? null : Number(value));
      default:
        return types.getTypeParser(oid, format as never);
    }
  },
};

/* -------------------------------------------------------------------------- */
/* Connection                                                                 */
/* -------------------------------------------------------------------------- */

type Connection = NeonQueryFunction<false, true>;

let connection: Connection | null = null;

/**
 * Memoised for the lifetime of the isolate. `neon()` opens no socket — it is a
 * configured fetch wrapper — so this is cheap, but re-deriving it per request
 * would re-parse the connection string on every call.
 */
function client(): Connection {
  if (connection) return connection;

  const url = env.DATABASE_URL;
  if (!url) {
    // Deliberately does not name the variable's value or the host.
    throw new Error("The appointment database is not configured.");
  }

  connection = neon(url, {
    fullResults: true,
    arrayMode: false,
    types: customTypes,
    isolationLevel: "Serializable",
  });
  return connection;
}

/** Test seam: drop the memoised client so a suite can swap the connection. */
export function resetConnection(): void {
  connection = null;
}

/* -------------------------------------------------------------------------- */
/* Placeholder rewriting                                                      */
/* -------------------------------------------------------------------------- */

const positionalCache = new Map<string, string>();

/**
 * `?` → `$1, $2, …`
 *
 * Scans rather than string-replaces, because a `?` inside a quoted literal is
 * data, not a placeholder. Skips single-quoted strings, double-quoted
 * identifiers, dollar-quoted blocks, and both comment forms.
 */
export function toPositional(sql: string): string {
  const cached = positionalCache.get(sql);
  if (cached !== undefined) return cached;

  let out = "";
  let index = 0;
  let position = 0;

  while (index < sql.length) {
    const char = sql[index];
    const next = sql[index + 1];

    // Single-quoted literal; '' is an escaped quote.
    if (char === "'") {
      const start = index;
      index += 1;
      while (index < sql.length) {
        if (sql[index] === "'" && sql[index + 1] === "'") {
          index += 2;
          continue;
        }
        if (sql[index] === "'") {
          index += 1;
          break;
        }
        index += 1;
      }
      out += sql.slice(start, index);
      continue;
    }

    // Double-quoted identifier; "" is an escaped quote.
    if (char === '"') {
      const start = index;
      index += 1;
      while (index < sql.length) {
        if (sql[index] === '"' && sql[index + 1] === '"') {
          index += 2;
          continue;
        }
        if (sql[index] === '"') {
          index += 1;
          break;
        }
        index += 1;
      }
      out += sql.slice(start, index);
      continue;
    }

    // Dollar-quoted block: $tag$ … $tag$
    if (char === "$") {
      const tag = /^\$[A-Za-z_]*\$/.exec(sql.slice(index));
      if (tag) {
        const marker = tag[0];
        const end = sql.indexOf(marker, index + marker.length);
        const stop = end === -1 ? sql.length : end + marker.length;
        out += sql.slice(index, stop);
        index = stop;
        continue;
      }
    }

    // Line comment.
    if (char === "-" && next === "-") {
      const end = sql.indexOf("\n", index);
      const stop = end === -1 ? sql.length : end;
      out += sql.slice(index, stop);
      index = stop;
      continue;
    }

    // Block comment.
    if (char === "/" && next === "*") {
      const end = sql.indexOf("*/", index + 2);
      const stop = end === -1 ? sql.length : end + 2;
      out += sql.slice(index, stop);
      index = stop;
      continue;
    }

    if (char === "?") {
      position += 1;
      out += `$${position}`;
      index += 1;
      continue;
    }

    out += char;
    index += 1;
  }

  positionalCache.set(sql, out);
  return out;
}

/* -------------------------------------------------------------------------- */
/* The D1-shaped surface                                                      */
/* -------------------------------------------------------------------------- */

export type QueryMeta = {
  /**
   * Rows affected. The only field of D1's `meta` the data layer ever read, and
   * the only one that means the same thing on both engines.
   */
  changes: number;
  /** Wall-clock milliseconds for the round trip. */
  duration: number;
};

export type QueryResult<T = Record<string, unknown>> = {
  results: T[];
  success: true;
  meta: QueryMeta;
};

export type WriteResult = {
  success: true;
  meta: QueryMeta;
};

/**
 * A bound statement. Lazy on purpose: nothing is sent until `run()`, `all()` or
 * `first()` is awaited, which is what lets `batch()` collect statements built
 * the ordinary way and submit them as one transaction.
 */
export class Statement {
  /** @internal */ readonly text: string;
  /** @internal */ readonly params: readonly unknown[];

  constructor(text: string, params: readonly unknown[] = []) {
    this.text = text;
    this.params = params;
  }

  /**
   * Matches D1: returns a new statement rather than mutating, so a prepared
   * statement can be bound more than once with different values.
   */
  bind(...values: unknown[]): Statement {
    return new Statement(this.text, values);
  }

  async all<T = Record<string, unknown>>(): Promise<QueryResult<T>> {
    const started = Date.now();
    const result = await client().query(this.text, this.params as unknown[]);
    return {
      results: (result.rows ?? []) as T[],
      success: true,
      meta: { changes: result.rowCount ?? 0, duration: Date.now() - started },
    };
  }

  async run(): Promise<WriteResult> {
    const started = Date.now();
    const result = await client().query(this.text, this.params as unknown[]);
    return {
      success: true,
      meta: { changes: result.rowCount ?? 0, duration: Date.now() - started },
    };
  }

  /** Provided for D1 parity. Returns the row, or one column of it. */
  async first<T = Record<string, unknown>>(column?: string): Promise<T | null> {
    const result = await client().query(this.text, this.params as unknown[]);
    const row = (result.rows ?? [])[0] as Record<string, unknown> | undefined;
    if (!row) return null;
    return (column === undefined ? row : row[column]) as T;
  }
}

export type Database = {
  prepare(sql: string): Statement;
  batch<T = Record<string, unknown>>(
    statements: readonly Statement[],
  ): Promise<QueryResult<T>[]>;
};

const handle: Database = {
  prepare(sql: string): Statement {
    return new Statement(toPositional(sql));
  },

  /**
   * All statements, one transaction, one round trip.
   *
   * An empty batch is a no-op rather than an error: several callers build their
   * statement list conditionally, and D1 tolerated the empty case.
   */
  async batch<T = Record<string, unknown>>(
    statements: readonly Statement[],
  ): Promise<QueryResult<T>[]> {
    if (statements.length === 0) return [];

    const started = Date.now();
    const sql = client();
    const results = await sql.transaction(
      statements.map((statement) =>
        sql.query(statement.text, statement.params as unknown[]),
      ),
    );
    const duration = Date.now() - started;

    return results.map((result) => ({
      results: (result.rows ?? []) as T[],
      success: true as const,
      meta: { changes: result.rowCount ?? 0, duration },
    }));
  },
};

/**
 * The single accessor. Each `db/*.ts` module used to declare its own
 * `database()` returning `env.DB`; they now import this one, which is the whole
 * reason the engine swap did not have to touch 240 call sites.
 */
export function database(): Database {
  // Surfaces a missing connection string here, at the first use, rather than at
  // a confusing point deep inside a query.
  client();
  return handle;
}
