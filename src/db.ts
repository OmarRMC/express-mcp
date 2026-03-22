import { sql } from "@vercel/postgres";

// ─────────────────────────────────────────────────────────────────────────────
// Schema — se ejecuta en cada cold start (idempotente con IF NOT EXISTS)
// ─────────────────────────────────────────────────────────────────────────────
await sql`
  CREATE TABLE IF NOT EXISTS users (
    id    SERIAL PRIMARY KEY,
    name  TEXT   NOT NULL,
    email TEXT   NOT NULL UNIQUE
  );
`;

// ─────────────────────────────────────────────────────────────────────────────
// Tipos
// ─────────────────────────────────────────────────────────────────────────────
export interface User {
  id:    number;
  name:  string;
  email: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Funciones exportadas
// ─────────────────────────────────────────────────────────────────────────────
export async function listUsers(): Promise<User[]> {
  const { rows } = await sql<User>`SELECT * FROM users ORDER BY id`;
  return rows;
}

export async function createUser(name: string, email: string): Promise<User> {
  const { rows } = await sql<User>`
    INSERT INTO users (name, email)
    VALUES (${name}, ${email})
    RETURNING *
  `;
  return rows[0];
}

export async function searchUsers(query: string): Promise<User[]> {
  const pattern = `%${query}%`;
  const { rows } = await sql<User>`
    SELECT * FROM users
    WHERE name ILIKE ${pattern} OR email ILIKE ${pattern}
    ORDER BY id
  `;
  return rows;
}
