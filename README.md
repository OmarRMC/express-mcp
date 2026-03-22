# express-mcp

Servidor **Express + TypeScript** que expone la misma lógica de negocio a través de dos interfaces simultáneas:

- **REST API** — endpoints HTTP clásicos consumibles desde cualquier cliente.
- **MCP Server** — herramientas compatibles con el [Model Context Protocol](https://modelcontextprotocol.io/) para integrarse directamente con agentes de IA (Claude Code, Cursor, etc.).

---

## Conceptos fundamentales

### REST API

Una **REST API** (Representational State Transfer) es un estilo de arquitectura para comunicar aplicaciones a través de HTTP. Cada recurso (usuarios, clima, etc.) se identifica con una URL y se opera con verbos estándar:

| Verbo | Acción |
|---|---|
| `GET` | Leer / consultar datos |
| `POST` | Crear un nuevo recurso |
| `PUT/PATCH` | Actualizar un recurso existente |
| `DELETE` | Eliminar un recurso |

El cliente envía una petición HTTP y el servidor responde con JSON. Es el enfoque clásico para construir backends consumidos por frontends, apps móviles u otros servicios.

---

### MCP — Model Context Protocol

**MCP** es un protocolo abierto creado por Anthropic que estandariza la forma en que los agentes de IA se conectan a herramientas y fuentes de datos externas. Es, en esencia, el "USB-C de las IAs": cualquier cliente compatible (Claude Code, Cursor, etc.) puede conectarse a cualquier servidor MCP sin integraciones a medida.

Un servidor MCP expone **herramientas** (_tools_): funciones con nombre, descripción y esquema de parámetros que el agente puede invocar de forma autónoma.

```
Cliente IA  ──────────────►  Servidor MCP  ──────────────►  Lógica / BD / APIs externas
 (Claude)     protocolo MCP   (este proyecto)    llamada interna
```

**¿Por qué usar MCP en vez de solo REST?**
- El agente puede descubrir y usar las herramientas sin documentación adicional.
- Las llamadas son estructuradas y validadas por esquema (Zod en este caso).
- La misma lógica de negocio sirve tanto a personas (REST) como a agentes (MCP).

---

### Transportes MCP

El protocolo MCP puede viajar sobre distintos mecanismos de transporte:

**StreamableHTTP** — El cliente envía un `POST` con el mensaje JSON y el servidor responde en el mismo request (puede ser una respuesta simple o un stream). Es el transporte moderno y recomendado porque funciona en cualquier entorno, incluyendo serverless.

**SSE (Server-Sent Events)** — El cliente abre una conexión HTTP persistente (`GET /mcp/sse`) y el servidor envía eventos de forma continua. Es un transporte unidireccional (servidor → cliente), por lo que los mensajes del cliente van por un endpoint separado (`POST /mcp/messages`). Funciona bien en servidores long-running, pero no en entornos serverless.

---

### Vercel Postgres (Neon)

**Vercel Postgres** es un servicio de base de datos PostgreSQL gestionado, construido sobre [Neon](https://neon.tech/). Neon es un PostgreSQL serverless que escala a cero cuando no hay actividad, lo que lo hace ideal para proyectos desplegados en Vercel.

El cliente `@vercel/postgres` expone una función `sql` con soporte para **template literals etiquetados**, que escapa automáticamente los parámetros y previene inyecciones SQL:

```ts
// Los valores interpolados se pasan como parámetros, nunca como texto literal
const { rows } = await sql`SELECT * FROM users WHERE email = ${email}`;
```

---

### Zod

**Zod** es una librería de validación y parsing de esquemas para TypeScript. Permite declarar la forma esperada de un dato y validarlo en tiempo de ejecución, con inferencia automática del tipo TypeScript correspondiente.

En este proyecto se usa para definir los parámetros de cada herramienta MCP:

```ts
// Declara el esquema → el SDK MCP lo convierte en JSON Schema automáticamente
{
  city:  z.string().describe("Nombre de la ciudad"),
  units: z.enum(["metric", "imperial"]).optional().default("metric"),
}
```

---

### Express

**Express** es el framework web más popular para Node.js. Permite definir rutas HTTP de forma declarativa y añadir middlewares (funciones que procesan la petición antes de llegar al handler). En este proyecto actúa como el contenedor que une la REST API y los endpoints MCP bajo un mismo servidor.

---

### TypeScript

**TypeScript** es un superconjunto tipado de JavaScript que compila a JS plano. El tipado estático detecta errores en tiempo de desarrollo (no en producción) y mejora el autocompletado en el editor. La compilación produce la carpeta `dist/` que es la que Node.js ejecuta realmente.

---

## Tecnologías

| Paquete | Uso |
|---|---|
| `express` | Servidor HTTP |
| `@modelcontextprotocol/sdk` | Implementación del protocolo MCP |
| `@vercel/postgres` | Cliente PostgreSQL (Neon / Vercel Postgres) |
| `zod` | Validación de esquemas para las herramientas MCP |
| `typescript` | Tipado estático |

---

## Estructura del proyecto

```
express-mcp/
├── src/
│   ├── index.ts   # Servidor Express, endpoints REST y servidor MCP
│   └── db.ts      # Acceso a la base de datos (Vercel Postgres)
├── dist/          # Código compilado (generado por tsc)
├── package.json
└── tsconfig.json
```

---

## Requisitos previos

- Node.js >= 18
- Una base de datos PostgreSQL compatible con Vercel Postgres (por ejemplo, [Neon](https://neon.tech/))
- API Key de [OpenWeatherMap](https://openweathermap.org/api)

---

## Variables de entorno

Crea un archivo `.env` en la raíz del proyecto:

```env
# OpenWeatherMap
OPENWEATHER_API_KEY=tu_api_key

# Vercel Postgres (se generan automáticamente en Vercel, o configúralas manualmente)
POSTGRES_URL=postgresql://user:password@host/database
POSTGRES_URL_NON_POOLING=postgresql://user:password@host/database

# Puerto local (opcional, por defecto 3000)
PORT=3000
```

> En Vercel las variables `POSTGRES_*` se añaden automáticamente al conectar una base de datos al proyecto.

---

## Instalación y uso

```bash
# Instalar dependencias
npm install

# Compilar TypeScript
npm run build

# Iniciar el servidor
npm start
```

### Modo desarrollo (watch)

```bash
npm run dev
```

Esto compila en modo watch y reinicia Node automáticamente al detectar cambios en `dist/`.

---

## REST API

### Clima

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/api/weather/:city` | Devuelve el clima actual de la ciudad indicada |

**Ejemplo:**
```bash
curl http://localhost:3000/api/weather/Madrid
```

```json
{
  "city": "Madrid",
  "country": "ES",
  "temp": 22.5,
  "feels_like": 21.8,
  "humidity": 45,
  "description": "cielo claro",
  "wind_speed": 3.1,
  "units": "metric"
}
```

### Usuarios

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/api/users` | Lista todos los usuarios |
| `GET` | `/api/users/search?q=texto` | Busca usuarios por nombre o email |
| `POST` | `/api/users` | Crea un nuevo usuario |

**Crear usuario — cuerpo JSON:**
```json
{ "name": "Ana García", "email": "ana@example.com" }
```

---

## MCP Server

El servidor expone las mismas operaciones como herramientas MCP bajo dos transportes:

### Herramientas disponibles

| Herramienta | Descripción | Parámetros |
|---|---|---|
| `get_weather` | Clima actual de una ciudad | `city` (string), `units` (`metric`\|`imperial`) |
| `list_users` | Lista todos los usuarios | — |
| `create_user` | Crea un nuevo usuario | `name` (string), `email` (string) |
| `search_users` | Busca usuarios por nombre o email | `query` (string) |

### Transporte StreamableHTTP (recomendado)

Compatible con Claude Code, Cursor y clientes MCP modernos.

```
POST http://localhost:3000/mcp
```

Configura en Claude Code (`~/.claude/settings.json`):

```json
{
  "mcpServers": {
    "express-mcp": {
      "type": "http",
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

### Transporte SSE (legacy)

Para clientes que no soporten StreamableHTTP:

```
GET  http://localhost:3000/mcp/sse       ← establecer conexión
POST http://localhost:3000/mcp/messages  ← enviar mensajes
```

> **Nota:** SSE no funciona de forma fiable en entornos serverless (Vercel) porque cada request puede ser manejado por una instancia distinta. Usa el endpoint `/mcp` en producción.

---

## Base de datos

El esquema se crea automáticamente en el arranque si no existe:

```sql
CREATE TABLE IF NOT EXISTS users (
  id    SERIAL PRIMARY KEY,
  name  TEXT   NOT NULL,
  email TEXT   NOT NULL UNIQUE
);
```

---

## Despliegue en Vercel

1. Conecta el repositorio a un proyecto de Vercel.
2. Añade una base de datos Postgres desde el dashboard de Vercel (las variables de entorno se inyectan automáticamente).
3. Añade `OPENWEATHER_API_KEY` en las variables de entorno del proyecto.
4. Vercel detecta `export default app` y sirve la función correctamente.

> En producción usa siempre el transporte **StreamableHTTP** (`POST /mcp`).
