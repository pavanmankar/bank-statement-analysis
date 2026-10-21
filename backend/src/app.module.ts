import { Module } from "@nestjs/common";
import { ChatController } from "./chat/chat.controller.js";
import { HealthController } from "./health.controller.js";
import { StatementsController } from "./statements/statements.controller.js";

@Module({
  controllers: [HealthController, ChatController, StatementsController],
})
export class AppModule {}
