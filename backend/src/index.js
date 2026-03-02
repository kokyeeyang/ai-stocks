import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import OpenAI from "openai";
import pg from "pg";
import { createApp } from "./app.js";

const connectionString = process.env.DATABASE_URL;
const pool = new pg.Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const app = createApp({
  prisma,
  openai,
  jwtSecret: process.env.JWT_SECRET,
  frontendOrigin: process.env.FRONTEND_ORIGIN || "",
  nodeEnv: process.env.NODE_ENV,
});

app.listen(process.env.PORT || 4000, () => {
  console.log(`Backend running on http://localhost:${process.env.PORT || 4000}`);
});
