import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { dateInput, parseEntryDate } from "../pond_diary/public/entry-dates.mjs";

test("the date field converts local time to UTC in winter and summer", () => {
  const previousZone = process.env.TZ;
  try {
    for (const [zone, winter, summer] of [
      ["UTC", "09:00", "09:00"],
      ["Europe/Warsaw", "08:00", "07:00"],
      ["America/New_York", "14:00", "13:00"]
    ]) {
      process.env.TZ = zone;
      for (const [date, utc] of [["2026-01-12", winter], ["2026-07-12", summer]]) {
        const value = `${date}T09:00`;
        assert.equal(parseEntryDate(value), `${date}T${utc}:00.000Z`);
        assert.equal(dateInput(parseEntryDate(value)), value);
      }
    }
  } finally {
    if (previousZone === undefined) delete process.env.TZ;
    else process.env.TZ = previousZone;
  }
});

test("the date field handles leap days and Warsaw clock changes", () => {
  const previousZone = process.env.TZ;
  process.env.TZ = "Europe/Warsaw";
  try {
    assert.equal(parseEntryDate("2024-02-29T00:15"), "2024-02-28T23:15:00.000Z");
    assert.equal(parseEntryDate("2026-11-12T00:05"), "2026-11-11T23:05:00.000Z");
    assert.throws(() => parseEntryDate("2026-02-29T09:00"), /valid date and time/);
    assert.throws(() => parseEntryDate("2026-03-29T02:30"), /clocks skip/);
    assert.throws(() => parseEntryDate(""), /valid date and time/);
    assert.equal(parseEntryDate("2026-03-29T01:59"), "2026-03-29T00:59:00.000Z");
    assert.equal(parseEntryDate("2026-03-29T03:00"), "2026-03-29T01:00:00.000Z");
    assert.equal(dateInput("2026-10-25T00:30:00.000Z"), "2026-10-25T02:30");
    assert.equal(dateInput("2026-10-25T01:30:41.123Z"), "2026-10-25T02:30");
    assert.equal(parseEntryDate("2026-10-25T02:30"), "2026-10-25T00:30:00.000Z");
  } finally {
    if (previousZone === undefined) delete process.env.TZ;
    else process.env.TZ = previousZone;
  }
});

async function startServer(directory) {
  const serverPath = fileURLToPath(new URL("../pond_diary/server.mjs", import.meta.url));
  const child = spawn(process.execPath, [serverPath], {
    env: { ...process.env, DATA_DIR: directory, PORT: "0", HOST: "127.0.0.1", SUPERVISOR_ONLY: "0", TZ: "UTC" },
    stdio: ["ignore", "pipe", "inherit"],
    windowsHide: true
  });
  const closed = once(child, "close");
  const url = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", code => reject(new Error(`Server exited before startup (${code})`)));
    child.stdout.on("data", data => {
      const match = String(data).match(/http:\/\/127\.0\.0\.1:\d+/);
      if (match) resolve(match[0]);
    });
  });
  return {
    async request(path, method = "GET", data, expected = 200) {
      const response = await fetch(url + path, {
        method,
        ...(data === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) })
      });
      assert.equal(response.status, expected, `${method} ${path}`);
      if (expected !== 204) return response.json();
    },
    async stop() {
      child.kill();
      await closed;
    }
  };
}

test("backdated tests leave existing entries intact through edits, deletion and restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pond-entry-dates-"));
  let server;
  try {
    server = await startServer(directory);
    const add = data => server.request("/api/entries", "POST", data, 201);
    const journal = async () => (await server.request("/api/journal")).entries;
    const event = { kind: "event", title: "Cleared the pond", occurred: "2026-10-25T01:30:41.123Z" };
    const { id: eventId } = await add(event);
    const [{ id: firstId }, { id: secondId }] = await Promise.all([
      add({ kind: "test", parameter: "ph", value: 7.1, occurred: "2026-10-18T23:40:00-04:00" }),
      add({ kind: "test", parameter: "ph", value: 7.5, occurred: "2026-10-21T09:15:00+02:00" })
    ]);
    const dates = (await journal()).map(entry => [entry.id, entry.occurred]);
    assert.deepEqual(dates, [
      [eventId, event.occurred],
      [secondId, "2026-10-21T07:15:00.000Z"],
      [firstId, "2026-10-19T03:40:00.000Z"]
    ]);

    const eventPath = `/api/entries/${eventId}`;
    const testPath = `/api/entries/${firstId}`;
    await server.request(eventPath, "PUT", { title: "Cleared the pond and filters" });
    assert.equal((await journal())[0].occurred, event.occurred);
    await server.request(testPath, "PUT", { parameter: "ph", value: 7.1, occurred: "2026-10-28T23:05:00Z" });
    assert.deepEqual((await journal()).map(entry => entry.id), [firstId, eventId, secondId]);
    await server.request(testPath, "PUT", { parameter: "ph", value: 7.2, occurred: "invalid" }, 400);
    await server.request("/api/entries", "POST", { kind: "event", title: "Missing timestamp" }, 400);
    const updated = await journal();
    assert.equal(updated[0].occurred, "2026-10-28T23:05:00.000Z");
    assert.equal(updated[0].value, 7.1);
    assert.equal(updated[1].occurred, event.occurred);

    await server.stop();
    server = undefined;
    server = await startServer(directory);
    assert.deepEqual(await journal(), updated);
    await server.request(testPath, "DELETE", undefined, 204);
    assert.deepEqual(await journal(), updated.slice(1));
  } finally {
    await server?.stop();
    await Promise.all(["pond.sqlite", "pond.sqlite-shm", "pond.sqlite-wal"].map(file => rm(join(directory, file), { force: true })));
    await rmdir(directory);
  }
});
