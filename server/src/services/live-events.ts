import { EventEmitter } from "node:events";
import type { LiveEvent, LiveEventType } from "@paperclipai/shared";
import { logger } from "../middleware/logger.js";

type LiveEventPayload = Record<string, unknown>;
type LiveEventListener = (event: LiveEvent) => void;
type LiveEventListenerErrorHandler = (err: Error, event: LiveEvent) => void;
type LiveEventSubscriptionOptions = {
  context?: string;
  onError?: LiveEventListenerErrorHandler;
};

const emitter = new EventEmitter();
emitter.setMaxListeners(0);

let nextEventId = 0;

function toLiveEvent(input: {
  companyId: string;
  type: LiveEventType;
  payload?: LiveEventPayload;
}): LiveEvent {
  nextEventId += 1;
  return {
    id: nextEventId,
    companyId: input.companyId,
    type: input.type,
    createdAt: new Date().toISOString(),
    payload: input.payload ?? {},
  };
}

export function publishLiveEvent(input: {
  companyId: string;
  type: LiveEventType;
  payload?: LiveEventPayload;
}) {
  const event = toLiveEvent(input);
  for (const listener of emitter.listeners(input.companyId)) {
    try {
      (listener as LiveEventListener)(event);
    } catch (err) {
      logger.warn(
        {
          err,
          companyId: input.companyId,
          eventType: input.type,
          eventId: event.id,
        },
        "live event listener failed",
      );
    }
  }
  return event;
}

export function publishGlobalLiveEvent(input: {
  type: LiveEventType;
  payload?: LiveEventPayload;
}) {
  const event = toLiveEvent({ companyId: "*", type: input.type, payload: input.payload });
  for (const listener of emitter.listeners("*")) {
    try {
      (listener as LiveEventListener)(event);
    } catch (err) {
      logger.warn(
        {
          err,
          companyId: "*",
          eventType: input.type,
          eventId: event.id,
        },
        "global live event listener failed",
      );
    }
  }
  return event;
}

function wrapListener(
  channel: string,
  listener: LiveEventListener,
  options?: LiveEventSubscriptionOptions,
): LiveEventListener {
  return (event) => {
    try {
      listener(event);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      logger.warn(
        {
          err: error,
          companyId: channel,
          eventType: event.type,
          eventId: event.id,
          listenerContext: options?.context ?? "live_event_listener",
        },
        "live event subscription callback failed",
      );
      options?.onError?.(error, event);
    }
  };
}

export function subscribeCompanyLiveEvents(
  companyId: string,
  listener: LiveEventListener,
  options?: LiveEventSubscriptionOptions,
) {
  const wrapped = wrapListener(companyId, listener, options);
  emitter.on(companyId, wrapped);
  return () => emitter.off(companyId, wrapped);
}

export function subscribeGlobalLiveEvents(listener: LiveEventListener, options?: LiveEventSubscriptionOptions) {
  const wrapped = wrapListener("*", listener, options);
  emitter.on("*", wrapped);
  return () => emitter.off("*", wrapped);
}
