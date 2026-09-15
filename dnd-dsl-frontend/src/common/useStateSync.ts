import { useEffect, useRef, useState } from 'react';
import { BackendURL } from '../contexts/BackendContext';
import type { CommandResponse } from '@dnd-language/evaluation/dnd-dsl-commands';

const CLIENT_ID_KEY = 'dnd-dsl-client-id';
const DISPLAY_NAME_KEY = 'dnd-dsl-display-name';
const RECONNECT_DELAY_MS = 2000;

// Per-tab identity (sessionStorage), not shared across tabs even on the same device -
// this is what StateSyncGateway keys "who is in control" on. Not real auth - a self-reported id.
function getOrCreateClientId(): string {
  try {
    let id = sessionStorage.getItem(CLIENT_ID_KEY);
    if (!id) {
      id = crypto.randomUUID();
      sessionStorage.setItem(CLIENT_ID_KEY, id);
    }
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

// Per-device display name (localStorage) - shared across tabs on the same browser,
// shown to other connected pages as "who's in control".
export function getDisplayName(): string {
  try {
    return localStorage.getItem(DISPLAY_NAME_KEY) ?? 'DM';
  } catch {
    return 'DM';
  }
}

export function setDisplayName(name: string): void {
  try {
    localStorage.setItem(DISPLAY_NAME_KEY, name || 'DM');
  } catch {
    // localStorage unavailable - the name just won't persist across reloads.
  }
}

type ServerMessage =
  | { type: 'WORLD_STATE'; payload: CommandResponse }
  | { type: 'CONTROLLER_CHANGED'; controllerId: string | null; controllerName: string | null };

/**
 * Opens the live-sync WebSocket (backend StateSyncGateway, /state-sync) and keeps it
 * connected. Every other open page's command/undo/redo/reparse arrives here as a
 * WORLD_STATE message; `onWorldState` applies it the same way a local command
 * response already does (DslContext.applyCommandResponse). Also tracks who currently
 * holds control of the shared undo/redo history and exposes `claimControl()` to take
 * it - see the multi-page-live-sync-roadmap memory. On reconnect (after a dropped
 * connection), calls `onReconnected` so the page can catch up on anything it missed
 * while disconnected (wired to DslContext.reloadWorld).
 */
export function useStateSync(onWorldState: (response: CommandResponse) => void, onReconnected: () => void) {
  const [isController, setIsController] = useState(false);
  const [controllerName, setControllerName] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const clientIdRef = useRef<string>(getOrCreateClientId());
  const wsRef = useRef<WebSocket | null>(null);

  // Refs so the effect below never needs these in its dependency array - it should
  // open exactly one connection for the component's lifetime, not reconnect whenever
  // a fresh callback identity comes in on a re-render.
  const onWorldStateRef = useRef(onWorldState);
  onWorldStateRef.current = onWorldState;
  const onReconnectedRef = useRef(onReconnected);
  onReconnectedRef.current = onReconnected;

  useEffect(() => {
    let cancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let hasConnectedBefore = false;

    const connect = () => {
      if (cancelled) return;
      const wsUrl = `${BackendURL.replace(/^http/, 'ws')}/state-sync`
        + `?id=${encodeURIComponent(clientIdRef.current)}&name=${encodeURIComponent(getDisplayName())}`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        if (cancelled) return;
        setConnected(true);
        if (hasConnectedBefore) onReconnectedRef.current();
        hasConnectedBefore = true;
      };

      ws.onmessage = (event) => {
        if (cancelled) return;
        let msg: ServerMessage;
        try {
          msg = JSON.parse(event.data);
        } catch {
          return;
        }
        if (msg.type === 'WORLD_STATE') {
          onWorldStateRef.current(msg.payload);
        } else if (msg.type === 'CONTROLLER_CHANGED') {
          setIsController(msg.controllerId === clientIdRef.current);
          setControllerName(msg.controllerName);
          // Nobody holds control (fresh start, or the previous holder disconnected) -
          // claim it automatically so Undo/Redo aren't left dead. Still the same
          // explicit CLAIM_CONTROL message a manual click sends; a page that already
          // holds control, or another already-connected page, can still take it away
          // with an explicit "Take control" click.
          if (msg.controllerId === null) ws.send(JSON.stringify({ type: 'CLAIM_CONTROL' }));
        }
      };

      ws.onclose = () => {
        if (cancelled) return;
        setConnected(false);
        reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
      };

      ws.onerror = () => ws.close();
    };

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      wsRef.current?.close();
    };
  }, []);

  const claimControl = () => {
    wsRef.current?.send(JSON.stringify({ type: 'CLAIM_CONTROL' }));
  };

  return { isController, controllerName, claimControl, connected, clientId: clientIdRef.current };
}
