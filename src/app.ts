import Fastify, { type FastifyInstance } from "fastify";
import type pg from "pg";
import { type Principal, verifyToken } from "./auth.js";
import { withTenant } from "./db.js";

declare module "fastify" {
  interface FastifyRequest {
    principal: Principal;
  }
}

type Deps = { pool: pg.Pool; jwtSecret: string; logger?: boolean };

export function buildApp({
  pool,
  jwtSecret,
  logger = false,
}: Deps): FastifyInstance {
  // removeAdditional: false -> unknown fields (e.g. a smuggled company_id) are rejected, not silently dropped.
  const app = Fastify({
    logger,
    ajv: { customOptions: { removeAdditional: false } },
  });

  app.get("/health", async () => ({ status: "ok" }));

  // Everything below requires an authenticated principal.
  app.register(async (scoped) => {
    scoped.decorateRequest("principal");
    scoped.addHook("onRequest", async (req, reply) => {
      const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
      if (!token) return reply.code(401).send({ error: "unauthorized" });
      try {
        req.principal = await verifyToken(token, jwtSecret);
      } catch {
        return reply.code(401).send({ error: "unauthorized" });
      }
    });

    // NOTE: no `WHERE company_id = ...` anywhere. Isolation is the database's job;
    // forgetting a filter here cannot leak data.
    scoped.get("/projects", async (req) =>
      withTenant(pool, req.principal.companyId, async (db) => {
        const { rows } = await db.query(
          "SELECT id, owner_id, name, created_at FROM projects ORDER BY created_at, id",
        );
        return rows;
      }),
    );

    scoped.get<{ Params: { id: string } }>(
      "/projects/:id",
      {
        schema: {
          params: {
            type: "object",
            properties: { id: { type: "string", format: "uuid" } },
          },
        },
      },
      async (req, reply) => {
        const project = await withTenant(
          pool,
          req.principal.companyId,
          async (db) => {
            const { rows } = await db.query(
              "SELECT id, owner_id, name, created_at FROM projects WHERE id = $1",
              [req.params.id],
            );
            return rows[0];
          },
        );
        // 404, not 403: another tenant's project is indistinguishable from a missing one.
        if (!project) return reply.code(404).send({ error: "not found" });
        return project;
      },
    );

    scoped.post<{ Body: { name: string } }>(
      "/projects",
      {
        schema: {
          body: {
            type: "object",
            required: ["name"],
            additionalProperties: false,
            properties: {
              name: { type: "string", minLength: 1, maxLength: 200 },
            },
          },
        },
      },
      async (req, reply) => {
        // company_id is filled by the column DEFAULT from the tenant context.
        const project = await withTenant(
          pool,
          req.principal.companyId,
          async (db) => {
            const { rows } = await db.query(
              "INSERT INTO projects (owner_id, name) VALUES ($1, $2) RETURNING id, owner_id, name, created_at",
              [req.principal.userId, req.body.name],
            );
            return rows[0];
          },
        );
        return reply.code(201).send(project);
      },
    );
  });

  return app;
}
