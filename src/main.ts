import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { ConsoleLogger } from "@nestjs/common";
import { AppModule } from "./app.module";
import { Config, CONFIG } from "./config/config.module";
async function main() {
  const app = await NestFactory.create(AppModule, {
    logger: new ConsoleLogger({ json: true }),
  });
  app.enableShutdownHooks();
  await app.listen(app.get<Config>(CONFIG).PORT, "0.0.0.0");
}
void main().catch((error) => {
  console.error("Startup failed:", error.name);
  process.exitCode = 1;
});
