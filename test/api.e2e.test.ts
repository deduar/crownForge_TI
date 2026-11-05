// The same guarantee, seen from the outside: an authenticated user of company A
// cannot see anything from company B through the API.
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { signToken } from "../src/auth.js";
import { config } from "../src/config.js";
import { createPool } from "../src/db.js";
import { SEED } from "../src/seed-ids.js";

const pool = createPool(config.databaseUrl);
let app: FastifyInstance;
let alice: string;
let bob: string;

beforeAll(async () => {
  app = buildApp({ pool, jwtSecret: config.jwtSecret });
  alice = `Bearer ${await signToken(SEED.alice, config.jwtSecret)}`;
  bob = `Bearer ${await signToken(SEED.bob, config.jwtSecret)}`;
});
afterAll(async () => {
  await app.close();
  await pool.end();
});

const get = (url: string, authorization?: string) =>
  app.inject({
    method: "GET",
    url,
    headers: authorization ? { authorization } : {},
  });

describe("API tenant isolation", () => {
  it("rejects unauthenticated and forged requests", async () => {
    expect((await get("/projects")).statusCode).toBe(401);
    const forged = `Bearer ${await signToken(SEED.alice, "some-other-secret-some-other-secret")}`;
    expect((await get("/projects", forged)).statusCode).toBe(401);
  });

  it("each user lists only their company's projects", async () => {
    const a = (await get("/projects", alice)).json();
    const b = (await get("/projects", bob)).json();
    const ids = (rows: { id: string }[]) => rows.map((r) => r.id);

    expect(ids(a)).toEqual(expect.arrayContaining([...SEED.acmeProjects]));
    expect(ids(a)).not.toContain(SEED.globexProject);
    expect(ids(b)).toEqual([SEED.globexProject]);
  });

  it("another company's project returns 404 (not 403)", async () => {
    expect(
      (await get(`/projects/${SEED.globexProject}`, alice)).statusCode,
    ).toBe(404);
    expect(
      (await get(`/projects/${SEED.acmeProjects[0]}`, alice)).statusCode,
    ).toBe(200);
  });

  it("a created project belongs to the creator's company and is invisible to the other", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/projects",
      headers: { authorization: alice },
      payload: { name: "Acme – New" },
    });
    expect(res.statusCode).toBe(201);
    const { id } = res.json();

    expect((await get(`/projects/${id}`, alice)).statusCode).toBe(200);
    expect((await get(`/projects/${id}`, bob)).statusCode).toBe(404);
  });

  it("rejects attempts to choose the tenant from the request body", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/projects",
      headers: { authorization: alice },
      payload: { name: "x", company_id: SEED.globex },
    });
    expect(res.statusCode).toBe(400);
  });
});
