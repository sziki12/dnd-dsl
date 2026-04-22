import { Injectable } from '@nestjs/common';
import { WebSocketGateway, OnGatewayConnection } from '@nestjs/websockets';
import { WebSocket } from 'ws';
import { createConnection, InitializeParams, Message, MessageReader, MessageWriter, WorkspaceFolder, Disposable  } from 'vscode-languageserver';
import { createDndDslServices } from '../dnd-language/language/src/dnd-dsl-module.js';
// Import your generated Langium module
import { IWebSocket, WebSocketMessageReader, WebSocketMessageWriter } from 'vscode-ws-jsonrpc/socket';
import { NodeFileSystem } from 'langium/node';
import { startLanguageServer } from 'langium/lsp';

@WebSocketGateway({ path: '/ls', cors: { origin: '*' } })
export class LangiumConnectionGateway implements OnGatewayConnection {
  async handleConnection(client: WebSocket) {
    try {
      const reader = new WebSocketMessageReader(new WebSocketWrapper(client));
      const writer = new WebSocketMessageWriter(new WebSocketWrapper(client));

      const originalListen = reader.listen.bind(reader);
      reader.listen = (callback): Disposable => {
        return originalListen((msg: Message) => {
          if (Message.isRequest(msg) && msg.method === 'initialize') {
            const params = msg.params as InitializeParams;
            if (params.workspaceFolders) {
              params.workspaceFolders = params.workspaceFolders.map(f => ({
                ...f,
                uri: decodeURIComponent(f.uri)
              }));
            }
          }
          try {
            callback(msg);
          } catch (e) {
            console.error('[LSP] Error processing message:', e);
          }
        });
      };

      const connection = createConnection(reader as any, writer as any);

      connection.onExit(() => console.log('[LSP] Connection closed'));

      const services = createDndDslServices({
        ...NodeFileSystem,
        connection: connection
      });

      startLanguageServer(services.shared);
      console.log('D&D Language Server is live.');
    } catch (e) {
      console.error('[LSP] Gateway handleConnection failed:', e);
    }
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
