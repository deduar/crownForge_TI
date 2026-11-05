// Prints a demo JWT for a seeded user: `npm run token -- alice` | `npm run token -- bob`
import { signToken } from "../auth.js";
import { config } from "../config.js";
import { SEED } from "../seed-ids.js";

const who = process.argv[2] === "bob" ? SEED.bob : SEED.alice;
console.log(await signToken(who, config.jwtSecret));
