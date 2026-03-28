type MessageHandler = (data: { type: string; [key: string]: unknown }) => void;

let socket: WebSocket | null = null;
let handlers: MessageHandler[] = [];
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

function getWsUrl() {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/ws`;
}

export function connect() {
  if (socket?.readyState === WebSocket.OPEN) return;

  socket = new WebSocket(getWsUrl());

  socket.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      for (const handler of handlers) handler(data);
    } catch { /* ignore malformed messages */ }
  };

  socket.onclose = () => {
    socket = null;
    reconnectTimer = setTimeout(connect, 3000);
  };

  socket.onerror = () => {
    socket?.close();
  };
}

export function disconnect() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = null;
  socket?.close();
  socket = null;
}

export function onMessage(handler: MessageHandler) {
  handlers.push(handler);
  return () => {
    handlers = handlers.filter((h) => h !== handler);
  };
}

export function send(data: unknown) {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(data));
  }
}
