import OpenAI from "openai";
import { OPENAI_API_KEY } from "astro:env/server";

if (!OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY is not configured — add it to your .env file");
}

export const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
