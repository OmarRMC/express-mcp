import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { listUsers, createUser, searchUsers } from "./db.js";

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

app.get("/api/users", (_req, res) => {
  res.json(listUsers());
});

app.get("/api/users/search", (req, res) => {
  const q = req.query.q as string | undefined;
  if (!q) {
    res.status(400).json({ error: "El parámetro 'q' es requerido" });
    return;
  }
  res.json(searchUsers(q));
});

app.post("/api/users", (req, res) => {
  const { name, email } = req.body;
  if (!name || !email) {
    res.status(400).json({ error: "name y email son requeridos" });
    return;
  }
  try {
    const newUser = createUser(name, email);
    res.status(201).json(newUser);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    if (message.includes("UNIQUE")) {
      res.status(409).json({ error: "El email ya está registrado" });
    } else {
      res.status(500).json({ error: message });
    }
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
    () => ({
      content: [{ type: "text", text: JSON.stringify(listUsers(), null, 2) }],
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
    ({ name, email }) => {
      try {
        const newUser = createUser(name, email);
        return {
          content: [{ type: "text", text: `Usuario creado: ${JSON.stringify(newUser)}` }],
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Error desconocido";
        const text = message.includes("UNIQUE")
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
    ({ query }) => ({
      content: [{ type: "text", text: JSON.stringify(searchUsers(query), null, 2) }],
    })
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
// Alternativa para clientes que no soporten StreamableHTTP
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
// START
// ─────────────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`\nServidor corriendo en http://localhost:${PORT}`);
  console.log(`\n── REST ──────────────────────────────────────────`);
  console.log(`  GET  http://localhost:${PORT}/api/weather/:city`);
  console.log(`  GET  http://localhost:${PORT}/api/users`);
  console.log(`  GET  http://localhost:${PORT}/api/users/search?q=...`);
  console.log(`  POST http://localhost:${PORT}/api/users`);
  console.log(`\n── MCP ───────────────────────────────────────────`);
  console.log(`  POST http://localhost:${PORT}/mcp         (StreamableHTTP)`);
  console.log(`  GET  http://localhost:${PORT}/mcp/sse     (SSE - conectar)`);
  console.log(`  POST http://localhost:${PORT}/mcp/messages (SSE - mensajes)`);
  console.log(`\n`);
});
