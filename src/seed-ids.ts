// Mirrors db/seed.sql (kept in sync by the tests that depend on it).
export const SEED = {
  acme: "aaaaaaaa-0000-0000-0000-000000000000",
  globex: "bbbbbbbb-0000-0000-0000-000000000000",
  alice: {
    userId: "aaaaaaaa-0000-0000-0000-00000000000a",
    companyId: "aaaaaaaa-0000-0000-0000-000000000000",
  },
  bob: {
    userId: "bbbbbbbb-0000-0000-0000-00000000000b",
    companyId: "bbbbbbbb-0000-0000-0000-000000000000",
  },
  acmeProjects: [
    "aaaaaaaa-0000-0000-0000-0000000000a1",
    "aaaaaaaa-0000-0000-0000-0000000000a2",
  ],
  globexProject: "bbbbbbbb-0000-0000-0000-0000000000b1",
} as const;
