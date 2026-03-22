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

await sql`
  CREATE TABLE IF NOT EXISTS expenses (
    id          SERIAL PRIMARY KEY,
    user_id     INTEGER          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    description TEXT             NOT NULL,
    amount      NUMERIC(12, 2)   NOT NULL CHECK (amount > 0),
    category    TEXT             NOT NULL DEFAULT 'General',
    date        DATE             NOT NULL DEFAULT CURRENT_DATE,
    created_at  TIMESTAMPTZ      DEFAULT NOW()
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

export interface Expense {
  id:          number;
  user_id:     number;
  description: string;
  amount:      number;
  category:    string;
  date:        string;
  created_at:  string;
}

export interface ExpenseSummary {
  category: string;
  count:    number;
  total:    number;
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

// ─────────────────────────────────────────────────────────────────────────────
// Expenses
// ─────────────────────────────────────────────────────────────────────────────
export async function addExpense(
  userId: number,
  description: string,
  amount: number,
  category: string,
  date?: string,
): Promise<Expense> {
  const { rows } = date
    ? await sql<Expense>`
        INSERT INTO expenses (user_id, description, amount, category, date)
        VALUES (${userId}, ${description}, ${amount}, ${category}, ${date})
        RETURNING *
      `
    : await sql<Expense>`
        INSERT INTO expenses (user_id, description, amount, category)
        VALUES (${userId}, ${description}, ${amount}, ${category})
        RETURNING *
      `;
  return rows[0];
}

export async function listExpensesByUser(userId: number): Promise<Expense[]> {
  const { rows } = await sql<Expense>`
    SELECT * FROM expenses
    WHERE user_id = ${userId}
    ORDER BY date DESC, created_at DESC
  `;
  return rows;
}

export async function getExpenseSummaryByUser(userId: number): Promise<ExpenseSummary[]> {
  const { rows } = await sql<ExpenseSummary>`
    SELECT
      category,
      COUNT(*)::int          AS count,
      SUM(amount)::float     AS total
    FROM expenses
    WHERE user_id = ${userId}
    GROUP BY category
    ORDER BY total DESC
  `;
  return rows;
}

export async function deleteExpense(id: number): Promise<boolean> {
  const { rowCount } = await sql`DELETE FROM expenses WHERE id = ${id}`;
  return (rowCount ?? 0) > 0;
}
