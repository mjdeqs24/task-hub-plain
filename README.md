# TaskHub

A full-stack task manager: a plain **HTML + Tailwind CSS + vanilla JavaScript** frontend talking to a **Node.js (ESM) + Express** REST API backed by **Microsoft SQL Server**.

```
TaskHub-Plain/
├── backend/
│   ├── .env.example
│   ├── package.json
│   └── src/
│       ├── server.js                  # Entry point (listen + graceful shutdown)
│       ├── app.js                     # Express app (CORS, JSON, routes, errors)
│       ├── config.js                  # Env configuration (dotenv)
│       ├── db/
│       │   ├── schema.sql             # T-SQL: creates `taskhub` DB + `tasks` table
│       │   ├── init.js                # `npm run db:init` — applies schema.sql
│       │   └── pool.js                # Shared mssql ConnectionPool
│       ├── repositories/taskRepository.js   # Parameterized T-SQL queries
│       ├── validators/taskValidators.js     # Zod schemas
│       ├── controllers/taskController.js
│       ├── routes/taskRoutes.js
│       ├── middleware/errorHandler.js
│       └── utils/HttpError.js
└── frontend/
    ├── index.html                     # Markup, styled entirely with Tailwind utility classes
    └── app.js                         # Vanilla JS + Fetch API
```

## Prerequisites

- **Node.js 18.18+** (20 LTS or newer recommended)
- **SQL Server 2017+** — any edition (Express, Developer, Docker, or Azure SQL)
- Optional: `sqlcmd`, SQL Server Management Studio (SSMS) or Azure Data Studio

---

## 1. Set up SQL Server

Pick **one** of the options below.

### Option A — Docker (quickest)

```bash
docker run -e "ACCEPT_EULA=Y" -e "MSSQL_SA_PASSWORD=YourStrong!Passw0rd" \
  -p 1433:1433 --name taskhub-sql -d mcr.microsoft.com/mssql/server:2022-latest
```

### Option B — Local install (Windows: SQL Server Express / Developer)

The `mssql` driver (tedious) connects over **TCP/IP with SQL Server authentication**, so:

1. **Enable SQL Server authentication:** SSMS → right-click the server → *Properties* → *Security* → *SQL Server and Windows Authentication mode*.
2. **Create a login** (or enable `sa`) and give it a strong password. To create the database it needs the `dbcreator` role (or `sysadmin`):
   ```sql
   CREATE LOGIN taskhub_app WITH PASSWORD = 'YourStrong!Passw0rd';
   ALTER SERVER ROLE dbcreator ADD MEMBER taskhub_app;
   ```
3. **Enable TCP/IP:** *SQL Server Configuration Manager* → *SQL Server Network Configuration* → *Protocols for SQLEXPRESS* → enable **TCP/IP**. Under *IP Addresses → IPAll* either set **TCP Port = 1433** (clear *TCP Dynamic Ports*), or keep dynamic ports and start the **SQL Server Browser** service.
4. **Restart** the SQL Server service.

### Create the database & table

Run [`backend/src/db/schema.sql`](backend/src/db/schema.sql) with any of:

- **npm script** (after configuring `.env` in step 2 and `npm install`):
  ```bash
  cd backend
  npm run db:init
  ```
- **sqlcmd**:
  ```bash
  sqlcmd -S localhost,1433 -U sa -P "YourStrong!Passw0rd" -C -i backend/src/db/schema.sql
  ```
- **SSMS / Azure Data Studio:** open the file and execute it.

The script is idempotent — it only creates the `taskhub` database, the `dbo.tasks` table and its index if they don't already exist.

---

## 2. Configure the backend

```bash
cd backend
cp .env.example .env        # PowerShell: Copy-Item .env.example .env
```

Edit `backend/.env`:

| Variable               | Description                                                       | Example               |
| ---------------------- | ----------------------------------------------------------------- | --------------------- |
| `PORT`                 | API port                                                          | `5000`                |
| `CORS_ORIGIN`          | `*` or comma-separated allowed origins                            | `http://localhost:5500` |
| `DB_SERVER`            | SQL Server host (or `host\INSTANCE` for named instances)          | `localhost`           |
| `DB_PORT`              | TCP port — leave **empty** when using `host\INSTANCE` + Browser   | `1433`                |
| `DB_USER`              | SQL login                                                         | `sa`                  |
| `DB_PASSWORD`          | SQL login password                                                | `YourStrong!Passw0rd` |
| `DB_NAME`              | Database name (schema.sql creates `taskhub`)                      | `taskhub`             |
| `DB_ENCRYPT`           | Encrypt the connection (`true` for Azure SQL)                     | `false`               |
| `DB_TRUST_SERVER_CERT` | Trust self-signed certs (local dev)                               | `true`                |

> **SQL Express example:** `DB_SERVER=localhost\SQLEXPRESS` with `DB_PORT=` empty (SQL Server Browser running), **or** `DB_SERVER=localhost` with `DB_PORT=1433` if you pinned the port.

## 3. Run the backend

```bash
cd backend
npm install
npm run dev      # auto-restarts on file changes (node --watch)
# or
npm start
```

You should see:

```
[server] TaskHub API listening on http://localhost:5000/api
[db] Connected to SQL Server localhost (database: taskhub)
```

Check it: <http://localhost:5000/api/health> → `{"status":"ok","database":"up"}`.

## 4. Serve the frontend

The frontend is static — serve the `frontend/` folder with any static file server (opening `index.html` via `file://` also works, but a server is recommended):

```bash
# Node (no install needed)
npx serve frontend -l 5500

# or Python
python -m http.server 5500 --directory frontend
```

Or use the VS Code **Live Server** extension. Then open <http://localhost:5500>.

The API base URL is configured in `frontend/index.html`:

```html
<meta name="taskhub-api-base" content="http://localhost:5000/api" />
```

Change it if your backend runs on a different host/port. If you restrict `CORS_ORIGIN`, include the frontend's origin.

> **Styling:** the UI is styled entirely with **Tailwind CSS v4**, loaded from a CDN (`@tailwindcss/browser@4`) in `index.html` — there is no separate stylesheet and no build step. Light/dark themes follow the OS setting via `dark:` variants. Dynamic states toggled by `app.js` (`is-completed`, `is-busy`, `is-leaving`, `is-loading`, `is-near-limit`) are styled with Tailwind arbitrary variants such as `[&.is-completed]:` and `group-[.is-loading]:`. The CDN build requires internet access; for production, consider compiling Tailwind with the Tailwind CLI instead.

---

## REST API

Base URL: `http://localhost:5000/api`. All bodies are JSON. Successful responses wrap results in `data`; errors use `{ "error": { "message", "details?" } }`.

| Method   | Endpoint          | Description                                                          |
| -------- | ----------------- | -------------------------------------------------------------------- |
| `GET`    | `/tasks`          | List tasks (newest first). Query: `search` (title contains), `status` = `all` \| `completed` \| `incomplete` |
| `GET`    | `/tasks/:id`      | Get one task                                                         |
| `POST`   | `/tasks`          | Create — body `{ "title", "description" }` (both required)           |
| `PATCH`  | `/tasks/:id`      | Update any of `{ "title", "description", "completed" }`; refreshes `updated_at` |
| `DELETE` | `/tasks/:id`      | Delete — `204 No Content`                                            |
| `GET`    | `/health`         | API + database health check                                          |

**Task shape**

```json
{
  "id": "0f8fad5b-d9cb-469f-a165-70867728950e",
  "title": "Write project proposal",
  "description": "Draft scope, timeline and budget.",
  "completed": false,
  "createdAt": "2026-10-26T15:58:00.123Z",
  "updatedAt": "2026-10-26T15:58:00.123Z"
}
```

**Status codes:** `200` OK · `201` Created · `204` Deleted · `400` validation error (with per-field `details`) · `404` not found · `503` database unavailable · `500` unexpected error.

**Examples**

```bash
curl -X POST http://localhost:5000/api/tasks \
  -H "Content-Type: application/json" \
  -d '{"title":"Buy milk","description":"2 liters, semi-skimmed"}'

curl "http://localhost:5000/api/tasks?search=milk&status=incomplete"

curl -X PATCH http://localhost:5000/api/tasks/<id> \
  -H "Content-Type: application/json" -d '{"completed":true}'

curl -X DELETE http://localhost:5000/api/tasks/<id>
```

## Security notes

- Every query uses `request.input(name, type, value)` parameters — no user input is concatenated into SQL. `LIKE` wildcards in search terms are escaped so they're matched literally.
- Request bodies and query strings are validated with Zod (`strict` objects reject unknown fields).
- The frontend renders user content with `textContent` only, never `innerHTML`, to prevent XSS.

## Troubleshooting

| Symptom | Fix |
| ------- | --- |
| `Failed to connect to localhost:1433` | SQL Server not running, TCP/IP disabled, or wrong port. See step 1B. |
| `Login failed for user` | Wrong credentials or SQL authentication mode not enabled. |
| `Cannot open database "taskhub"` | Run the schema script (`npm run db:init`). |
| `self-signed certificate` | Set `DB_TRUST_SERVER_CERT=true` for local development. |
| Red banner "Unable to reach the TaskHub API" | Backend not running, or the `taskhub-api-base` meta tag points to the wrong URL. |
| CORS error in the browser console | Add the frontend origin to `CORS_ORIGIN` (or use `*`). |

