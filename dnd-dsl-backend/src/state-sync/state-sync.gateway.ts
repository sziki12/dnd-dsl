import { randomUUID } from 'crypto';
import type { IncomingMessage } from 'http';
import { OnGatewayConnection, OnGatewayDisconnect, WebSocketGateway } from '@nestjs/websockets';
import { WebSocket } from 'ws';
import type { CommandResponse } from '@dnd-language/evaluation/dnd-dsl-commands.js';

type ClientInfo = { id: string; name: string };

type ServerMessage =
  | { type: 'WORLD_STATE'; payload: CommandResponse }
  | { type: 'CONTROLLER_CHANGED'; controllerId: string | null; controllerName: string | null };

type ClientMessage = { type: 'CLAIM_CONTROL' };

/**
 * Broadcasts world-state changes to every connected page in real time, and tracks
 * which one page (if any) currently holds "control" of the shared undo/redo history.
 * See the multi-page-live-sync-roadmap memory: a command still lands in ONE shared
 * CommandService history regardless of which page issued it - this gateway is what
 * lets every OTHER open page find out live, and what enforces that only the page
 * holding control may rewind it (isController() below is the enforcement).
 *
 * Deliberately independent of langium/WorldStateService/CommandService - no risk of
 * pulling either into a context that can't load them (see LangiumConnectionGateway,
 * which is a different gateway entirely for the LSP connection at /ls).
 */
@WebSocketGateway({ path: '/state-sync', cors: { origin: '*' } })
export class StateSyncGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly clients = new Map<WebSocket, ClientInfo>();
  private controllerId: string | null = null;

  handleConnection(client: WebSocket, request: IncomingMessage): void {
    const url = new URL(request.url ?? '', 'http://localhost');
    const id = url.searchParams.get('id') ?? randomUUID();
    const name = url.searchParams.get('name') ?? 'DM';
    this.clients.set(client, { id, name });

    // Tell the new page who's in control right away, so it doesn't have to wait for
    // the next change to know.
    this.send(client, this.controllerMessage());

    client.on('message', (raw) => this.handleMessage(client, raw.toString()));
  }

  handleDisconnect(client: WebSocket): void {
    const info = this.clients.get(client);
    this.clients.delete(client);
    // The controller's own page closing must not strand control forever.
    if (info && this.controllerId === info.id) {
      this.controllerId = null;
      this.broadcast(this.controllerMessage());
    }
  }

  /** Sent to every connected page after any command, undo, redo, or /parse reparse. */
  broadcastState(response: CommandResponse): void {
    this.broadcast({ type: 'WORLD_STATE', payload: response });
  }

  isController(clientId: string): boolean {
    return this.controllerId !== null && this.controllerId === clientId;
  }

  private handleMessage(client: WebSocket, raw: string): void {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg.type === 'CLAIM_CONTROL') {
      const info = this.clients.get(client);
      if (!info) return;
      this.controllerId = info.id;
      this.broadcast(this.controllerMessage());
    }
  }

  private controllerMessage(): ServerMessage {
    const controller = this.controllerId
      ? [...this.clients.values()].find((c) => c.id === this.controllerId)
      : undefined;
    return {
      type: 'CONTROLLER_CHANGED',
      controllerId: this.controllerId,
      controllerName: controller?.name ?? null,
    };
  }

  private send(client: WebSocket, message: ServerMessage): void {
    if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(message));
  }

  private broadcast(message: ServerMessage): void {
    for (const client of this.clients.keys()) this.send(client, message);
  }
}
