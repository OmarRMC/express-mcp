import initSqlJs from "sql.js";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const DATA_DIR   = join(__dirname, "..", "data");
const DB_PATH    = join(DATA_DIR, "users.db");
const WASM_PATH  = join(__dirname, "..", "node_modules", "sql.js", "dist", "sql-wasm.wasm");

// ─────────────────────────────────────────────────────────────────────────────
// Inicialización (top-level await, válido en ESM)
// ─────────────────────────────────────────────────────────────────────────────
const SQL = await initSqlJs({ wasmBinary: readFileSync(WASM_PATH) as unknown as ArrayBuffer });

mkdirSync(DATA_DIR, { recursive: true });

const db = existsSync(DB_PATH)
  ? new SQL.Database(readFileSync(DB_PATH))
  : new SQL.Database();

function save() {
  writeFileSync(DB_PATH, Buffer.from(db.export()));
}

// ─────────────────────────────────────────────────────────────────────────────
// Schema + datos iniciales
// ─────────────────────────────────────────────────────────────────────────────
db.run(`
  CREATE TABLE IF NOT EXISTS users (
    id    INTEGER PRIMARY KEY AUTOINCREMENT,
    name  TEXT    NOT NULL,
    email TEXT    NOT NULL UNIQUE
  );
`);

const [[count]] = db.exec("SELECT COUNT(*) FROM users")[0]?.values ?? [[0]];
if ((count as number) === 0) {
  db.run("INSERT INTO users (name, email) VALUES (?, ?)", ["Ana García",   "ana@example.com"]);
  db.run("INSERT INTO users (name, email) VALUES (?, ?)", ["Carlos López", "carlos@example.com"]);
  save();
}

// ─────────────────────────────────────────────────────────────────────────────
// Tipos
// ─────────────────────────────────────────────────────────────────────────────
export interface User {
  id:    number;
  name:  string;
  email: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function queryAll(sql: string, params: (string | number)[] = []): User[] {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows: User[] = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject() as unknown as User);
  }
  stmt.free();
  return rows;
}

// ─────────────────────────────────────────────────────────────────────────────
// Funciones exportadas
// ─────────────────────────────────────────────────────────────────────────────
export function listUsers(): User[] {
  return queryAll("SELECT * FROM users ORDER BY id");
}

export function createUser(name: string, email: string): User {
  db.run("INSERT INTO users (name, email) VALUES (?, ?)", [name, email]);
  const id = (db.exec("SELECT last_insert_rowid()")[0].values[0][0]) as number;
  save();
  return { id, name, email };
}

export function searchUsers(query: string): User[] {
  const pattern = `%${query}%`;
  return queryAll(
    "SELECT * FROM users WHERE name LIKE ? OR email LIKE ? ORDER BY id",
    [pattern, pattern]
  );
}
