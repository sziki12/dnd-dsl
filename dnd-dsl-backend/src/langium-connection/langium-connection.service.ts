import { Injectable } from '@nestjs/common';
import { WebSocketGateway, OnGatewayConnection } from '@nestjs/websockets';
import { WebSocket } from 'ws';
import { createConnection, MessageReader, MessageWriter } from 'vscode-languageserver';
import { createDndDslServices } from '../dnd-language/language/src/dnd-dsl-module.js';
// Import your generated Langium module
import { IWebSocket, WebSocketMessageReader, WebSocketMessageWriter } from 'vscode-ws-jsonrpc/socket';
import { NodeFileSystem } from 'langium/node';
import { startLanguageServer } from 'langium/lsp';

@WebSocketGateway({ path: '/ls', cors: { origin: '*' } })
export class LangiumConnectionGateway implements OnGatewayConnection {
  handleConnection(client: WebSocket) {
    // 1. Create Reader/Writer
    
    const reader = new WebSocketMessageReader(new WebSocketWrapper(client));
    const writer = new WebSocketMessageWriter(new WebSocketWrapper(client));

    // 2. Fix the 'createConnection' error by using 'any' for the arguments
    // This forces TS to pick the (reader, writer) overload
    const connection = createConnection(reader as any, writer as any);

    // 3. Merge everything into the Service Context
    // We combine the NodeFileSystem implementation with our active connection
    const services = createDndDslServices({
      ...NodeFileSystem,
      connection: connection
    });

    // 4. Start the server using ONLY the shared services
    // The connection is already registered inside 'services' now
    startLanguageServer(services.shared);

    console.log('D&D Language Server is live.');
  }
}

class WebSocketWrapper implements IWebSocket {
  constructor(private ws: WebSocket) {}
    send(content: string): void {
        this.ws.send(content);
    }
    onMessage(cb: (data: any) => void): void {
        this.ws.on('message', cb);
    }
    onError(cb: (reason: any) => void): void {
        this.ws.on('error', cb);
    }
    onClose(cb: (code: number, reason: string) => void): void {
        this.ws.on('close', (code, reason) => cb(code, reason.toString()));
    }
    dispose(): void {
        this.ws.close();
    }
}
