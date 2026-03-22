import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { listUsers, createUser, searchUsers, addExpense, listExpensesByUser, getExpenseSummaryByUser, deleteExpense } from "./db.js";

const app = express();
app.use(express.json());

const OPENWEATHER_API_KEY = process.env.OPENWEATHER_API_KEY || "d86df30e416424956a9bb1f9f016f048";

// ─────────────────────────────────────────────────────────────────────────────
// LÓGICA DE NEGOCIO (reutilizable desde REST y MCP)
// ─────────────────────────────────────────────────────────────────────────────
async function getWeatherData(city: string, units: "metric" | "imperial" = "metric") {
  const url = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)}&appid=${OPENWEATHER_API_KEY}&units=${units}&lang=es`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(response.status === 404 ? `Ciudad no encontrada: ${city}` : `Error API: ${response.status}`);
  }

  const data = await response.json() as {
    name: string;
    sys: { country: string };
    main: { temp: number; humidity: number; feels_like: number };
    weather: { description: string }[];
    wind: { speed: number };
  };

  return {
    city:        data.name,
    country:     data.sys.country,
    temp:        data.main.temp,
    feels_like:  data.main.feels_like,
    humidity:    data.main.humidity,
    description: data.weather[0].description,
    wind_speed:  data.wind.speed,
    units,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// REST ENDPOINTS
// ─────────────────────────────────────────────────────────────────────────────
app.get("/api/weather/:city", async (req, res) => {
  try {
    const data = await getWeatherData(req.params.city);
    res.json(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    res.status(404).json({ error: message });
  }
});

app.get("/api/users", async (_req, res) => {
  try {
    res.json(await listUsers());
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    res.status(500).json({ error: message });
  }
});

app.get("/api/users/search", async (req, res) => {
  const q = req.query.q as string | undefined;
  if (!q) {
    res.status(400).json({ error: "El parámetro 'q' es requerido" });
    return;
  }
  try {
    res.json(await searchUsers(q));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    res.status(500).json({ error: message });
  }
});

app.post("/api/users", async (req, res) => {
  const { name, email } = req.body;
  if (!name || !email) {
    res.status(400).json({ error: "name y email son requeridos" });
    return;
  }
  try {
    const newUser = await createUser(name, email);
    res.status(201).json(newUser);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    if (message.includes("unique") || message.includes("UNIQUE") || message.includes("duplicate")) {
      res.status(409).json({ error: "El email ya está registrado" });
    } else {
      res.status(500).json({ error: message });
    }
  }
});

// ── Expenses ──────────────────────────────────────────────────────────────────

app.post("/api/users/:userId/expenses", async (req, res) => {
  const userId = parseInt(req.params.userId);
  if (isNaN(userId)) { res.status(400).json({ error: "userId inválido" }); return; }

  const { description, amount, category = "General", date } = req.body;
  if (!description || amount === undefined) {
    res.status(400).json({ error: "description y amount son requeridos" });
    return;
  }
  if (typeof amount !== "number" || amount <= 0) {
    res.status(400).json({ error: "amount debe ser un número mayor a 0" });
    return;
  }
  try {
    const expense = await addExpense(userId, description, amount, category, date);
    res.status(201).json(expense);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    if (message.includes("foreign key") || message.includes("violates")) {
      res.status(404).json({ error: "Usuario no encontrado" });
    } else {
      res.status(500).json({ error: message });
    }
  }
});

app.get("/api/users/:userId/expenses", async (req, res) => {
  const userId = parseInt(req.params.userId);
  if (isNaN(userId)) { res.status(400).json({ error: "userId inválido" }); return; }
  try {
    res.json(await listExpensesByUser(userId));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    res.status(500).json({ error: message });
  }
});

app.get("/api/users/:userId/expenses/summary", async (req, res) => {
  const userId = parseInt(req.params.userId);
  if (isNaN(userId)) { res.status(400).json({ error: "userId inválido" }); return; }
  try {
    res.json(await getExpenseSummaryByUser(userId));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    res.status(500).json({ error: message });
  }
});

app.delete("/api/expenses/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "id inválido" }); return; }
  try {
    const deleted = await deleteExpense(id);
    if (!deleted) { res.status(404).json({ error: "Gasto no encontrado" }); return; }
    res.json({ message: "Gasto eliminado" });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    res.status(500).json({ error: message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// MCP SERVER FACTORY
// Cada conexión crea su propia instancia para evitar colisiones de estado
// ─────────────────────────────────────────────────────────────────────────────
function createMcpServer() {
  const server = new McpServer({ name: "express-mcp", version: "1.0.0" });

  // Tool 1: Clima
  server.tool(
    "get_weather",
    "Obtiene el clima actual de una ciudad",
    {
      city:  z.string().describe("Nombre de la ciudad"),
      units: z.enum(["metric", "imperial"]).optional().default("metric"),
    },
    async ({ city, units }) => {
      try {
        const data = await getWeatherData(city, units);
        const u = units === "metric" ? "°C" : "°F";
        return {
          content: [{
            type: "text",
            text: [
              `Clima en ${data.city}, ${data.country}`,
              `Temperatura:   ${data.temp}${u} (sensación: ${data.feels_like}${u})`,
              `Descripción:   ${data.description}`,
              `Humedad:       ${data.humidity}%`,
              `Viento:        ${data.wind_speed} m/s`,
            ].join("\n"),
          }],
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Error desconocido";
        return { content: [{ type: "text", text: message }] };
      }
    }
  );

  // Tool 2: Listar usuarios
  server.tool(
    "list_users",
    "Lista todos los usuarios registrados",
    {},
    async () => ({
      content: [{ type: "text", text: JSON.stringify(await listUsers(), null, 2) }],
    })
  );

  // Tool 3: Crear usuario
  server.tool(
    "create_user",
    "Crea un nuevo usuario en el sistema",
    {
      name:  z.string().describe("Nombre completo"),
      email: z.string().email().describe("Email del usuario"),
    },
    async ({ name, email }) => {
      try {
        const newUser = await createUser(name, email);
        return {
          content: [{ type: "text", text: `Usuario creado: ${JSON.stringify(newUser)}` }],
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Error desconocido";
        const text = message.includes("unique") || message.includes("duplicate")
          ? `Error: El email '${email}' ya está registrado`
          : `Error: ${message}`;
        return { content: [{ type: "text", text }] };
      }
    }
  );

  // Tool 4: Buscar usuarios
  server.tool(
    "search_users",
    "Busca usuarios por nombre o email",
    {
      query: z.string().describe("Texto a buscar en nombre o email"),
    },
    async ({ query }) => ({
      content: [{ type: "text", text: JSON.stringify(await searchUsers(query), null, 2) }],
    })
  );

  // Tool 5: Agregar gasto
  server.tool(
    "add_expense",
    "Registra un nuevo gasto para un usuario",
    {
      user_id:     z.number().int().positive().describe("ID del usuario"),
      description: z.string().describe("Descripción del gasto"),
      amount:      z.number().positive().describe("Monto del gasto (mayor a 0)"),
      category:    z.string().optional().default("General").describe("Categoría del gasto (ej: Comida, Transporte, Salud)"),
      date:        z.string().optional().describe("Fecha del gasto en formato YYYY-MM-DD (por defecto hoy)"),
    },
    async ({ user_id, description, amount, category, date }) => {
      try {
        const expense = await addExpense(user_id, description, amount, category, date);
        return { content: [{ type: "text", text: `Gasto registrado: ${JSON.stringify(expense, null, 2)}` }] };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Error desconocido";
        const text = message.includes("foreign key") || message.includes("violates")
          ? `Error: El usuario con id ${user_id} no existe`
          : `Error: ${message}`;
        return { content: [{ type: "text", text }] };
      }
    }
  );

  // Tool 6: Listar gastos de un usuario
  server.tool(
    "list_expenses",
    "Lista todos los gastos registrados de un usuario",
    {
      user_id: z.number().int().positive().describe("ID del usuario"),
    },
    async ({ user_id }) => {
      const expenses = await listExpensesByUser(user_id);
      const text = expenses.length === 0
        ? `El usuario ${user_id} no tiene gastos registrados.`
        : JSON.stringify(expenses, null, 2);
      return { content: [{ type: "text", text }] };
    }
  );

  // Tool 7: Resumen de gastos por categoría
  server.tool(
    "get_expense_summary",
    "Muestra el resumen de gastos agrupados por categoría para un usuario",
    {
      user_id: z.number().int().positive().describe("ID del usuario"),
    },
    async ({ user_id }) => {
      const summary = await getExpenseSummaryByUser(user_id);
      if (summary.length === 0) {
        return { content: [{ type: "text", text: `El usuario ${user_id} no tiene gastos registrados.` }] };
      }
      const total = summary.reduce((acc, s) => acc + s.total, 0);
      const lines = [
        `Resumen de gastos — usuario #${user_id}`,
        "─".repeat(40),
        ...summary.map(s => `  ${s.category.padEnd(20)} ${s.count} gastos   $${s.total.toFixed(2)}`),
        "─".repeat(40),
        `  ${"TOTAL".padEnd(20)}              $${total.toFixed(2)}`,
      ];
      return { content: [{ type: "text", text: lines.join("\n") }] };
    }
  );

  // Tool 8: Eliminar gasto
  server.tool(
    "delete_expense",
    "Elimina un gasto por su ID",
    {
      id: z.number().int().positive().describe("ID del gasto a eliminar"),
    },
    async ({ id }) => {
      const deleted = await deleteExpense(id);
      const text = deleted ? `Gasto #${id} eliminado correctamente.` : `Error: Gasto #${id} no encontrado.`;
      return { content: [{ type: "text", text }] };
    }
  );

  return server;
}

// ─────────────────────────────────────────────────────────────────────────────
// MCP vía StreamableHTTP → POST /mcp
// Recomendado para clientes modernos (Claude Code, Cursor, etc.)
// ─────────────────────────────────────────────────────────────────────────────
app.all("/mcp", async (req, res) => {
  const server    = createMcpServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

  res.on("finish", () => server.close());

  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

// ─────────────────────────────────────────────────────────────────────────────
// MCP vía SSE → GET /mcp/sse  +  POST /mcp/messages
// Nota: en Vercel (serverless) SSE no funciona de forma fiable porque cada
// request puede ir a una instancia distinta. Usar /mcp (StreamableHTTP).
// ─────────────────────────────────────────────────────────────────────────────
const sseConnections = new Map<string, SSEServerTransport>();

app.get("/mcp/sse", async (req, res) => {
  const transport = new SSEServerTransport("/mcp/messages", res);
  const server    = createMcpServer();

  sseConnections.set(transport.sessionId, transport);

  res.on("close", () => {
    sseConnections.delete(transport.sessionId);
    server.close();
  });

  await server.connect(transport);
});

app.post("/mcp/messages", async (req, res) => {
  const sessionId  = req.query.sessionId as string;
  const transport  = sseConnections.get(sessionId);

  if (!transport) {
    res.status(404).json({ error: "Sesión SSE no encontrada" });
    return;
  }

  await transport.handlePostMessage(req, res);
});

// ─────────────────────────────────────────────────────────────────────────────
// START — En Vercel se exporta el app; en local se levanta el servidor
// ─────────────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;

if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`\nServidor corriendo en http://localhost:${PORT}`);
    console.log(`\n── REST ──────────────────────────────────────────`);
    console.log(`  GET    http://localhost:${PORT}/api/weather/:city`);
    console.log(`  GET    http://localhost:${PORT}/api/users`);
    console.log(`  GET    http://localhost:${PORT}/api/users/search?q=...`);
    console.log(`  POST   http://localhost:${PORT}/api/users`);
    console.log(`  POST   http://localhost:${PORT}/api/users/:userId/expenses`);
    console.log(`  GET    http://localhost:${PORT}/api/users/:userId/expenses`);
    console.log(`  GET    http://localhost:${PORT}/api/users/:userId/expenses/summary`);
    console.log(`  DELETE http://localhost:${PORT}/api/expenses/:id`);
    console.log(`\n── MCP ───────────────────────────────────────────`);
    console.log(`  POST http://localhost:${PORT}/mcp          (StreamableHTTP)`);
    console.log(`  GET  http://localhost:${PORT}/mcp/sse      (SSE - conectar)`);
    console.log(`  POST http://localhost:${PORT}/mcp/messages (SSE - mensajes)`);
    console.log(`\n`);
  });
}

export default app;
