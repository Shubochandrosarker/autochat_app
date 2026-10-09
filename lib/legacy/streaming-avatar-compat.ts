/**
 * LiveAvatar compatibility layer for @heygen/streaming-avatar API surface.
 *
 * Wraps the official @heygen/liveavatar-web-sdk (LiveAvatarSession) and
 * exposes the same class shape the legacy HeyGen streaming avatar app expects:
 *   new StreamingAvatar({ token })            -> session created
 *   avatar.createStartAvatar(config)          -> session.start() (+ optional context_id)
 *   avatar.stopAvatar()                       -> session.stop()
 *   avatar.on(<StreamingEvents.X>, handler)   -> event bridge
 *   avatar.speak({ text, taskType, taskMode })-> avatar repeat/message
 *   avatar.startVoiceChat/closeVoiceChat      -> voiceChat start/stop
 *   avatar.muteInputAudio/unmuteInputAudio    -> voiceChat mute/unmute
 *   avatar.interrupt()                        -> session.interrupt()
 *   avatar.startListening()/stopListening()   -> push-to-talk style listen control
 *
 * Server side must mint a LiveAvatar session token first:
 *   POST https://api.liveavatar.com/v1/sessions/token  (X-API-KEY: <key>)
 *   body: { mode: "FULL", avatar_id, context_id?, max_session_duration? }
 *   -> { data: { session_id, session_token } }
 * The token returned is what the client passes to `new StreamingAvatar({ token })`.
 */
import {
  LiveAvatarSession,
  SessionEvent,
  SessionState,
  AgentEventsEnum,
} from "@heygen/liveavatar-web-sdk";

export enum StreamingEvents {
  STREAM_READY = "STREAM_READY",
  STREAM_DISCONNECTED = "STREAM_DISCONNECTED",
  CONNECTION_QUALITY_CHANGED = "CONNECTION_QUALITY_CHANGED",
  USER_START = "USER_START",
  USER_STOP = "USER_STOP",
  USER_END_MESSAGE = "USER_END_MESSAGE",
  USER_TALKING_MESSAGE = "USER_TALKING_MESSAGE",
  AVATAR_END_MESSAGE = "AVATAR_END_MESSAGE",
  AVATAR_TALKING_MESSAGE = "AVATAR_TALKING_MESSAGE",
  AVATAR_START_TALKING = "AVATAR_START_TALKING",
  AVATAR_STOP_TALKING = "AVATAR_STOP_TALKING",
}

export enum AvatarQuality {
  High = "high",
  Low = "low",
}

export enum TaskType {
  TALK = "talk",
  REPEAT = "repeat",
}

export enum TaskMode {
  SYNC = "sync",
  ASYNC = "async",
}

export enum VoiceEmotion {
  EXCITED = "Excited",
  Serene = "Serene",
}

export enum ElevenLabsModel {
  eleven_flash_v2_5 = "eleven_flash_v2_5",
}

export enum STTProvider {
  DEEPGRAM = "deepgram",
}

export enum VoiceChatTransport {
  WEBSOCKET = "websocket",
  HTTP = "http",
}

/** Minimal StartAvatarRequest shim — most fields are HeyGen-only and ignored. */
export interface StartAvatarRequest {
  quality?: AvatarQuality | string;
  avatarName?: string;
  avatarId?: string;
  knowledgeId?: string;
  knowledgeBase?: string;
  language?: string;
  voice?: {
    rate?: number;
    emotion?: VoiceEmotion | string;
    model?: ElevenLabsModel | string;
  };
  voiceChatTransport?: VoiceChatTransport | string;
  sttSettings?: { provider?: STTProvider | string };
  contextId?: string;
  [key: string]: unknown;
}

export interface StreamingTalkingMessageEvent {
  message: string;
}

export interface UserTalkingMessageEvent {
  message: string;
}

export enum ConnectionQuality {
  UNKNOWN = "unknown",
  EXCELLENT = "excellent",
  GOOD = "good",
  BAD = "bad",
}

type Handler = (payload: { detail?: unknown }) => void;

const QUALITY_MAP: Record<string, ConnectionQuality> = {
  excellent: ConnectionQuality.EXCELLENT,
  good: ConnectionQuality.GOOD,
  poor: ConnectionQuality.BAD,
  bad: ConnectionQuality.BAD,
};

export default class StreamingAvatarCompat {
  declare __liveAvatarId?: string;
  private session: LiveAvatarSession;
  private handlers = new Map<string, Set<Handler>>();
  private _startConfig: StartAvatarRequest = {};
  private stateWatch?: ReturnType<typeof setInterval>;

  constructor(options: { token: string; basePath?: string }) {
    this.session = new LiveAvatarSession(options.token, {
      autoKeepAlive: true,
    });
    this.wireEvents();
  }

  private emit(event: string, detail?: unknown) {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const h of Array.from(set)) {
      try {
        h({ detail });
      } catch (e) {
        console.error("[liveavatar-compat] handler error", event, e);
      }
    }
  }

  private onAny(event: string, handler: Handler) {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(handler);
    return () => {
      this.handlers.get(event)?.delete(handler);
    };
  }

  private wireEvents() {
    const s = this.session as unknown as {
      on: (evt: string, cb: (...a: unknown[]) => void) => unknown;
      off: (evt: string, cb: (...a: unknown[]) => void) => unknown;
    };

    const onStreamReady = () => {
      // Build a MediaStream from the attached LiveKit remote tracks so legacy
      // <video srcObject={stream}> keeps working.
      const stream = this.extractMediaStream();
      this.emit(StreamingEvents.STREAM_READY, stream ?? new MediaStream());
    };

    const onDisconnected = (reason?: unknown) => {
      this.emit(StreamingEvents.STREAM_DISCONNECTED, { reason });
    };

    const onQuality = (q?: unknown) => {
      const key = typeof q === "string" ? q.toLowerCase() : "";
      this.emit(
        StreamingEvents.CONNECTION_QUALITY_CHANGED,
        QUALITY_MAP[key] ?? ConnectionQuality.UNKNOWN,
      );
    };

    const onUserSpeakStarted = () => this.emit(StreamingEvents.USER_START);
    const onUserSpeakEnded = () => this.emit(StreamingEvents.USER_STOP);
    const onAvatarSpeakStarted = () =>
      this.emit(StreamingEvents.AVATAR_START_TALKING);
    const onAvatarSpeakEnded = () =>
      this.emit(StreamingEvents.AVATAR_STOP_TALKING);

    const onUserTranscription = (data?: { text?: string }) => {
      this.emit(StreamingEvents.USER_TALKING_MESSAGE, {
        message: data?.text ?? "",
      });
    };
    const onUserTranscriptionChunk = (data?: { text?: string }) => {
      this.emit(StreamingEvents.USER_TALKING_MESSAGE, {
        message: data?.text ?? "",
      });
    };
    const onAvatarTranscription = (data?: { text?: string }) => {
      this.emit(StreamingEvents.AVATAR_TALKING_MESSAGE, {
        message: data?.text ?? "",
      });
    };
    const onAvatarTranscriptionChunk = (data?: { text?: string }) => {
      this.emit(StreamingEvents.AVATAR_TALKING_MESSAGE, {
        message: data?.text ?? "",
      });
    };
    const onSessionStopped = () => {
      this.emit(StreamingEvents.USER_END_MESSAGE);
      this.emit(StreamingEvents.AVATAR_END_MESSAGE);
    };

    // NOTE: must call s.on(...) BOUND to the session — destructuring/detaching `.on`
    // makes `this` undefined inside the SDK's EventEmitter (TypeError: Cannot read
    // properties of undefined (reading '_events')). Verified 2026-10-09.
    s.on(SessionEvent.SESSION_STREAM_READY, onStreamReady);
    s.on(SessionEvent.SESSION_DISCONNECTED, onDisconnected as (...a: unknown[]) => void);
    s.on(SessionEvent.SESSION_CONNECTION_QUALITY_CHANGED, onQuality as (...a: unknown[]) => void);
    s.on(AgentEventsEnum.USER_SPEAK_STARTED, onUserSpeakStarted as (...a: unknown[]) => void);
    s.on(AgentEventsEnum.USER_SPEAK_ENDED, onUserSpeakEnded as (...a: unknown[]) => void);
    s.on(AgentEventsEnum.AVATAR_SPEAK_STARTED, onAvatarSpeakStarted as (...a: unknown[]) => void);
    s.on(AgentEventsEnum.AVATAR_SPEAK_ENDED, onAvatarSpeakEnded as (...a: unknown[]) => void);
    s.on(AgentEventsEnum.USER_TRANSCRIPTION, onUserTranscription as (...a: unknown[]) => void);
    s.on(AgentEventsEnum.USER_TRANSCRIPTION_CHUNK, onUserTranscriptionChunk as (...a: unknown[]) => void);
    s.on(AgentEventsEnum.AVATAR_TRANSCRIPTION, onAvatarTranscription as (...a: unknown[]) => void);
    s.on(AgentEventsEnum.AVATAR_TRANSCRIPTION_CHUNK, onAvatarTranscriptionChunk as (...a: unknown[]) => void);
    s.on(AgentEventsEnum.SESSION_STOPPED, onSessionStopped as (...a: unknown[]) => void);
  }

  /**
   * Attach the underlying LiveAvatar/LiveKit tracks to a media element.
   * REQUIRED for video to actually animate: the SDK's LiveKit room runs with
   * adaptiveStream enabled, which only requests video layers for tracks that
   * are attached to a visible element (track.attach -> UpdateTrackSettings).
   * Legacy code that only sets `video.srcObject = stream` bypasses that
   * signaling -> server pauses video after the first keyframe (static avatar
   * with working audio). Verified 2026-10-09.
   */
  attachElement(element: HTMLMediaElement): void {
    try {
      (
        this.session as unknown as { attach: (el: HTMLMediaElement) => void }
      ).attach(element);
    } catch (e) {
      console.warn("[liveavatar-compat] attachElement failed", e);
    }
  }

  private extractMediaStream(): MediaStream | null {
    try {
      const s = this.session as unknown as {
        _remoteVideoTrack?: { mediaStreamTrack?: MediaStreamTrack };
        _remoteAudioTrack?: { mediaStreamTrack?: MediaStreamTrack };
      };
      const vt = s._remoteVideoTrack?.mediaStreamTrack;
      const at = s._remoteAudioTrack?.mediaStreamTrack;
      if (!vt && !at) return null;
      const ms = new MediaStream();
      if (vt) ms.addTrack(vt);
      if (at) ms.addTrack(at);
      return ms;
    } catch {
      return null;
    }
  }

  /** Legacy: registers event handler. Returns the instance for chaining. */
  on(event: StreamingEvents | string, handler: Handler): this {
    this.onAny(event, handler);
    return this;
  }

  off(event: StreamingEvents | string, handler: Handler): this {
    this.handlers.get(event)?.delete(handler);
    return this;
  }

  /** Legacy: start session. `config.avatarId/avatarName` may carry a context override. */
  async createStartAvatar(config: StartAvatarRequest = {}): Promise<this> {
    this._startConfig = config || {};
    await this.session.start();
    this.startStateWatch();
    return this;
  }

  private startStateWatch() {
    // Map state changes to legacy events that matter (connected handled via STREAM_READY).
    if (this.stateWatch) clearInterval(this.stateWatch);
    let last = this.session.state;
    this.stateWatch = setInterval(() => {
      const cur = this.session.state;
      if (cur !== last) {
        last = cur;
        if (cur === SessionState.DISCONNECTED) {
          this.emit(StreamingEvents.STREAM_DISCONNECTED, { reason: "state" });
        }
      }
    }, 2000);
  }

  async stopAvatar(): Promise<void> {
    if (this.stateWatch) clearInterval(this.stateWatch);
    this.stateWatch = undefined;
    try {
      await this.session.stop();
    } catch (e) {
      console.warn("[liveavatar-compat] stop error", e);
    }
  }

  /** Legacy speak(): REPEAT => verbatim text; TALK => pass through avatar pipeline. */
  speak(options: {
    text: string;
    taskType?: TaskType | string;
    taskMode?: TaskMode | string;
  }): string {
    const isRepeat =
      String(options.taskType ?? "").toLowerCase() === TaskType.REPEAT;
    const text = options.text ?? "";
    return isRepeat ? this.session.repeat(text) : this.session.message(text);
  }

  async startVoiceChat(_options?: { isInputAudioMuted?: boolean }): Promise<void> {
    try {
      await this.session.voiceChat?.start(
        _options && _options.isInputAudioMuted
          ? ({ isInputAudioMuted: true } as never)
          : (undefined as never),
      );
    } catch (e) {
      console.warn("[liveavatar-compat] startVoiceChat", e);
    }
  }

  async closeVoiceChat(): Promise<void> {
    try {
      this.session.voiceChat?.stop();
    } catch (e) {
      console.warn("[liveavatar-compat] closeVoiceChat", e);
    }
  }

  async muteInputAudio(): Promise<void> {
    try {
      await this.session.voiceChat?.mute();
    } catch (e) {
      console.warn("[liveavatar-compat] muteInputAudio", e);
    }
  }

  async unmuteInputAudio(): Promise<void> {
    try {
      await this.session.voiceChat?.unmute();
    } catch (e) {
      console.warn("[liveavatar-compat] unmuteInputAudio", e);
    }
  }

  interrupt(): void {
    try {
      this.session.interrupt();
    } catch (e) {
      console.warn("[liveavatar-compat] interrupt", e);
    }
  }

  startListening(): string {
    try {
      return this.session.startListening();
    } catch {
      return "";
    }
  }

  stopListening(): string {
    try {
      return this.session.stopListening();
    } catch {
      return "";
    }
  }

  getLiveAvatarSession(): LiveAvatarSession {
    return this.session;
  }
}
export { StreamingAvatarCompat };
