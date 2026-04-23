import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { WsAdapter } from '@nestjs/platform-ws';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useWebSocketAdapter(new WsAdapter(app));
  app.enableCors({
        origin: 'http://localhost:5173', // Vite dev server
        methods: ['GET', 'POST'],
    });
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
