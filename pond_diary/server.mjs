import { createServer } from "node:http";
import { createReadStream, existsSync, mkdirSync, readFileSync } from "node:fs";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { resolve, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parameters } from "./public/parameters.mjs";
import { maxPhotoBytes } from "./public/photo-upload.mjs";

const directory = resolve(process.env.DATA_DIR || ".pond-data");
mkdirSync(directory, { recursive: true });
const optionsPath = join(directory, "options.json");
const reminderToken = existsSync(optionsPath) ? JSON.parse(readFileSync(optionsPath, "utf8")).reminder_token : undefined;
const tokenHash = token => createHash("sha256").update(token).digest();
const reminderTokenHash = typeof reminderToken === "string" && reminderToken.length >= 32
  ? tokenHash(reminderToken) : null;
const db = new DatabaseSync(join(directory, "pond.sqlite"));
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL, image TEXT
  );
  CREATE TABLE IF NOT EXISTS entries (
    id TEXT PRIMARY KEY, kind TEXT NOT NULL, occurred TEXT NOT NULL,
    payload TEXT NOT NULL, image TEXT, created TEXT NOT NULL
  );
`);

const entries = db.prepare("SELECT id, kind, occurred, payload, image IS NOT NULL AS hasImage FROM entries ORDER BY occurred DESC, created DESC, id DESC");
const products = db.prepare("SELECT id, name, description, image IS NOT NULL AS hasImage FROM products ORDER BY name COLLATE NOCASE, id");
const entryById = db.prepare("SELECT * FROM entries WHERE id = ?");
const productById = db.prepare("SELECT * FROM products WHERE id = ?");
const lastWaterTest = db.prepare("SELECT occurred FROM entries WHERE kind = 'test' AND occurred <= ? ORDER BY occurred DESC LIMIT 1");
const limit = 6 * 1024 * 1024;
const imagePattern = /^data:(image\/(?:jpeg|png|webp|gif));base64,([a-z0-9+/]+={0,2})$/i;
const assets = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/style.css", ["style.css", "text/css; charset=utf-8"]],
  ["/app.mjs", ["app.mjs", "text/javascript; charset=utf-8"]],
  ["/charts.mjs", ["charts.mjs", "text/javascript; charset=utf-8"]],
  ["/echarts.mjs", ["../node_modules/echarts/dist/echarts.esm.min.mjs", "text/javascript; charset=utf-8"]],
  ["/entry-dates.mjs", ["entry-dates.mjs", "text/javascript; charset=utf-8"]],
  ["/photo-upload.mjs", ["photo-upload.mjs", "text/javascript; charset=utf-8"]],
  ["/parameters.mjs", ["parameters.mjs", "text/javascript; charset=utf-8"]]
]);

class RequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function invalid(message) {
  throw new RequestError(400, message);
}

function field(value, label, max, required = false) {
  if (typeof value !== "string" || value.trim().length > max || (required && !value.trim())) {
    invalid(`Enter a valid ${label} (up to ${max} characters).`);
  }
  return value.trim();
}

function image(value, previous = null) {
  if (value === undefined) return previous;
  if (value === null) return null;
  const match = typeof value === "string" && value.length <= limit && imagePattern.exec(value);
  if (!match) invalid("Choose a JPEG, PNG, WebP, or GIF image under 4 MB.");
  const bytes = Buffer.from(match[2], "base64");
  if (!bytes.length || bytes.length > maxPhotoBytes) invalid("Choose an image under 4 MB.");
  return value;
}

async function body(request) {
  if (request.headers["content-type"]?.split(";")[0].trim() !== "application/json") {
    throw new RequestError(415, "Send a JSON request.");
  }
  if (Number(request.headers["content-length"]) > limit) {
    request.resume();
    throw new RequestError(413, "This upload is too large.");
  }
  const chunks = [];
  let length = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    length += chunk.length;
    if (length > limit) {
      request.resume();
      throw new RequestError(413, "This upload is too large.");
    }
    chunks.push(chunk);
  }
  try {
    const data = JSON.parse(Buffer.concat(chunks).toString());
    if (!data || typeof data !== "object" || Array.isArray(data)) invalid("Invalid request.");
    return data;
  } catch {
    invalid("Invalid JSON request.");
  }
}

function saveEntry(data, id) {
  const previous = id && entryById.get(id);
  if (id && !previous) throw new RequestError(404, "Entry no longer exists.");
  const kind = previous ? previous.kind : data.kind;
  const suppliedDate = data.occurred === undefined ? previous?.occurred : data.occurred;
  const timestamp = typeof suppliedDate === "string" ? Date.parse(suppliedDate) : NaN;
  if (!Number.isFinite(timestamp)) invalid("Enter the date and time of the entry.");
  const occurred = new Date(timestamp).toISOString();
  const attachment = image(data.image, previous?.image);
  let payload;
  switch (kind) {
    case "test": {
      const spec = typeof data.parameter === "string" && Object.hasOwn(parameters, data.parameter) && parameters[data.parameter];
      if (!spec || typeof data.value !== "number" || !Number.isFinite(data.value) || data.value < 0 || data.value > (spec.max ?? Infinity)) {
        invalid("Enter a valid reading for the selected parameter.");
      }
      payload = { parameter: data.parameter, value: data.value, notes: field(data.notes ?? "", "note", 2000) };
      break;
    }
    case "treatment": {
      const product = typeof data.productId === "string" && productById.get(data.productId);
      const previousPayload = previous && JSON.parse(previous.payload);
      const savedName = previousPayload?.productId === data.productId ? previousPayload?.productName : null;
      if (!product && !savedName) invalid("Select a product from the library.");
      payload = {
        productId: data.productId, productName: savedName ?? product?.name,
        dose: field(data.dose ?? "", "dose", 120), notes: field(data.notes ?? "", "note", 2000)
      };
      break;
    }
    case "event":
    case "photo": {
      if (kind === "photo" && !attachment) invalid("Choose a photo.");
      const hashtags = kind === "event" && data.tags === undefined ? [] : data.tags;
      if (!Array.isArray(hashtags) || hashtags.length > 20) invalid("Use up to 20 hashtags.");
      const tags = [...new Set(hashtags.map(tag => field(tag, "hashtag", 32, true)))];
      if (tags.some(tag => !/^[\p{L}\p{M}\p{N}_-]+$/u.test(tag))) invalid("Use letters, numbers, underscores, or hyphens in hashtags.");
      payload = {
        title: field(data.title, "title", 120, true), description: field(data.description ?? "", "description", 2000), tags
      };
      break;
    }
    default:
      invalid("Choose an entry type.");
  }
  id ||= randomUUID();
  db.prepare(`
    INSERT INTO entries (id, kind, occurred, payload, image, created) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET occurred=excluded.occurred, payload=excluded.payload, image=excluded.image
  `).run(id, kind, occurred, JSON.stringify(payload), attachment, new Date().toISOString());
  return { id };
}

function saveProduct(data, id) {
  const previous = id && productById.get(id);
  if (id && !previous) throw new RequestError(404, "Product no longer exists.");
  const name = field(data.name, "product name", 120, true);
  const description = field(data.description ?? "", "description", 2000);
  const attachment = image(data.image, previous?.image);
  id ||= randomUUID();
  db.prepare(`
    INSERT INTO products (id, name, description, image) VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name, description=excluded.description, image=excluded.image
  `).run(id, name, description, attachment);
  return { id };
}

function json(response, status, data) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(data));
}

const server = createServer(async (request, response) => {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Referrer-Policy", "no-referrer");
  try {
    const url = new URL(request.url, "http://localhost");
    const method = request.method;
    if (url.pathname === "/api/reminders/last-water-test") {
      const token = request.headers["x-pond-diary-token"];
      if (!reminderTokenHash || typeof token !== "string" || !timingSafeEqual(reminderTokenHash, tokenHash(token))) {
        throw new RequestError(404, "Page not found.");
      }
      if (method !== "GET") throw new RequestError(405, "Method not allowed.");
      json(response, 200, { last_water_test: lastWaterTest.get(new Date().toISOString())?.occurred ?? null });
      return;
    }
    if (process.env.SUPERVISOR_ONLY === "1" && request.socket.remoteAddress !== "172.30.32.2") {
      throw new RequestError(403, "Open Pond Diary through Home Assistant.");
    }
    const asset = assets.get(url.pathname);
    if (asset && method === "GET") {
      response.setHeader("Content-Security-Policy", "default-src 'self'; img-src 'self' blob:; style-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'");
      response.writeHead(200, { "Content-Type": asset[1] });
      createReadStream(new URL(`./public/${asset[0]}`, import.meta.url))
        .on("error", () => response.destroy()).pipe(response);
      return;
    }
    if (url.pathname === "/api/journal" && method === "GET") {
      json(response, 200, {
        entries: entries.all().map(({ payload, ...entry }) => ({ ...entry, ...JSON.parse(payload) })),
        products: products.all()
      });
      return;
    }
    const route = /^\/api\/(entries|products)(?:\/([a-f0-9-]{36})(\/image)?)?$/.exec(url.pathname);
    if (!route) throw new RequestError(404, "Page not found.");
    const [, collection, id, attachment] = route;
    const isEntry = collection === "entries";
    if (attachment && method === "GET") {
      const stored = (isEntry ? entryById : productById).get(id);
      const match = stored?.image && imagePattern.exec(stored.image);
      if (!match) throw new RequestError(404, "Image not found.");
      const bytes = Buffer.from(match[2], "base64");
      response.writeHead(200, { "Content-Type": match[1], "Content-Length": bytes.length });
      response.end(bytes);
      return;
    }
    if (!attachment && ((method === "POST" && !id) || (method === "PUT" && id))) {
      const data = await body(request);
      json(response, id ? 200 : 201, (isEntry ? saveEntry : saveProduct)(data, id));
      return;
    }
    if (!attachment && method === "DELETE" && id) {
      const statement = isEntry ? "DELETE FROM entries WHERE id = ?" : "DELETE FROM products WHERE id = ?";
      if (!db.prepare(statement).run(id).changes) throw new RequestError(404, "Record no longer exists.");
      response.writeHead(204).end();
      return;
    }
    throw new RequestError(405, "Method not allowed.");
  } catch (error) {
    if (!(error instanceof RequestError)) console.error(error);
    if (!response.headersSent) json(response, error.status || 500, { error: error.status ? error.message : "Could not complete the request." });
    else response.destroy();
  }
});

server.listen(Number(process.env.PORT ?? 8099), process.env.HOST || "127.0.0.1", () => {
  const { address, port } = server.address();
  console.log(`Pond Diary listening on http://${address}:${port}`);
});
