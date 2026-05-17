import { buildApp } from "./app.js";

const DEFAULT_PORT = 3366;
const DEFAULT_HOST = "0.0.0.0";

async function main() {
  const app = buildApp();
  const port = Number.parseInt(process.env.PORT ?? "", 10) || DEFAULT_PORT;
  const host = process.env.HOST || DEFAULT_HOST;

  try {
    await app.listen({ port, host });
    app.log.info({ host, port }, "v2 api listening");
  } catch (error) {
    app.log.error(error, "v2 api failed to start");
    process.exit(1);
  }
}

void main();
