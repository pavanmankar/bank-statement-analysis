import { Module } from "@nestjs/common";
import { ChatController } from "./chat/chat.controller.js";
import { StatementsController } from "./statements/statements.controller.js";

@Module({
  controllers: [ChatController, StatementsController],
})
export class AppModule {}
