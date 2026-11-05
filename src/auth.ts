import { jwtVerify, SignJWT } from "jose";

export type Principal = { userId: string; companyId: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Token issuance is out of scope (an IdP would do it); this exists for the demo and tests.
export async function signToken(p: Principal, secret: string): Promise<string> {
  return new SignJWT({ company_id: p.companyId })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(p.userId)
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(secret));
}

/** The tenant comes from a verified token, never from a header, query string or body. */
export async function verifyToken(
  token: string,
  secret: string,
): Promise<Principal> {
  const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
    algorithms: ["HS256"],
  });
  const companyId = payload.company_id;
  if (
    typeof payload.sub !== "string" ||
    typeof companyId !== "string" ||
    !UUID.test(companyId)
  ) {
    throw new Error("invalid claims");
  }
  return { userId: payload.sub, companyId };
}
