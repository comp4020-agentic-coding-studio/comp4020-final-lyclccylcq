import { api, avatar, fill, h, svg } from "/ui.js";

// Two-person voice calls between people on the same trip (ADR 0004).
// Signalling: authenticated POSTs out, targeted `call` events in on the
// trip's existing event stream. Media: native WebRTC, audio only, directly
// between the two browsers or through a TURN relay. Nothing is recorded,
// transcribed or sent to the AI.
//
// Negotiation follows MDN's "perfect negotiation": the callee is polite,
// the caller impolite, so simultaneous offers resolve the same way on both
// sides. Signals that arrive before this tab's peer connection exists are
// held until it does; candidates before the remote description are queued.
//
// The controller owns its DOM: a small "Call" button for the trip bar and a
// floating call window mounted once on <body>, with one persistent <audio>
// element. Editor re-renders, snapshots and tab switches never touch them.

// How long a dropped call keeps trying before it ends with "Call again".
// A phone moving between Wi-Fi and mobile data can take well over 15 s.
const RECOVER_MS = 30_000;
const recoverMs = () => Number(new URLSearchParams(location.search).get("recoverms")) || RECOVER_MS;
// "disconnected" often heals by itself within a few seconds; only after
// this long (or on "failed") does the call restart ICE and say Reconnecting.
const GRACE_MS = 3_000;
// ICE restarts are retried until connected: after these delays, then every 5 s
const RETRY_MS = [1_500, 3_000, 5_000];
// A first connection that hasn't connected by now never will on its own: a
// lost offer or answer leaves ICE at "new" or "checking", which never turns
// "failed". So it gets the same recovery as a dropped call.
const CONNECT_MS = 15_000;
const connectMs = () => Number(new URLSearchParams(location.search).get("connectms")) || CONNECT_MS;
// below this measured level, a track counts as silent (RMS of -50 dBFS)
const SPEAKING = 0.003;

const I = {
  phone: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.6 10.8a15.1 15.1 0 006.6 6.6l2.2-2.2a1 1 0 011-.25 11.4 11.4 0 003.6.57 1 1 0 011 1V20a1 1 0 01-1 1A17 17 0 013 4a1 1 0 011-1h3.5a1 1 0 011 1c0 1.25.2 2.45.57 3.57a1 1 0 01-.25 1z" fill="currentColor"/></svg>',
  hang: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1a1 1 0 01-.56.9c-.98.49-1.87 1.12-2.66 1.85a1 1 0 01-1.4-.02L.29 13.07a1 1 0 010-1.41A16.94 16.94 0 0112 7c4.57 0 8.72 1.8 11.71 4.66a1 1 0 010 1.41l-2.48 2.48a1 1 0 01-1.4.02 11.3 11.3 0 00-2.67-1.85 1 1 0 01-.56-.9v-3.1A15 15 0 0012 9z" fill="currentColor"/></svg>',
  mic: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 14a3 3 0 003-3V5a3 3 0 00-6 0v6a3 3 0 003 3zm5-3a5 5 0 01-10 0H5a7 7 0 006 6.92V21h2v-3.08A7 7 0 0019 11z" fill="currentColor"/></svg>',
  micOff: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 10.6V5a3 3 0 00-5.94-.6zM19 11h-2c0 .74-.16 1.44-.45 2.07l1.47 1.47A6.96 6.96 0 0019 11zM4.27 3L3 4.27l6 6V11a3 3 0 004.53 2.58l1.52 1.52A5 5 0 017 11H5a7 7 0 006 6.92V21h2v-3.08a6.9 6.9 0 002.93-1.06L19.73 21 21 19.73z" fill="currentColor"/></svg>',
  min: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12h12" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>',
  max: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 14l5-5 5 5" stroke="currentColor" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  sound: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9zm12.5 3a4.5 4.5 0 00-2.5-4v8a4.5 4.5 0 002.5-4zM14 3.2v2.1a7 7 0 010 13.4v2.1a9 9 0 000-17.6z" fill="currentColor"/></svg>',
};
const ico = (name) => svg(I[name]);

export function createVoice({ base, session, me, getMembers, getPresence, onChange, debug = false }) {
  // phase: idle | outgoing | incoming | connecting | connected | reconnecting | ended
  const V = {
    phase: "idle", callId: null, peer: null, role: null, muted: false, peerMuted: false, error: null, endedReason: null,
    needsSound: false, elsewhere: false, lastPeerId: null, relay: null, minimized: false, connectedAt: null,
    // what the audio path is doing, measured: see audioState()
    micLevel: 0, peerLevel: 0, sending: null, receiving: null, playing: false, playError: null, diag: null,
  };
  let pc = null;
  let stream = null;
  let remote = null; // the MediaStream the <audio> plays, built from received tracks
  let polite = false;
  let makingOffer = false;
  let ignoreOffer = false;
  let pendingCandidates = [];
  let earlySignals = []; // signals for this call that came before the peer connection
  let beforeCallId = []; // events that came while our Call request was still out
  const seenSeq = new Map(); // callId -> highest seq handled
  let recoverTimer = null;
  let connectTimer = null;
  let ringTimer = null;
  let tickTimer = null;
  let meter = null; // { ctx, local, remote } analysers for the level meters
  const ended = new Set(); // call ids that are over; anything later for them is ignored
  let destroyed = false;

  // --- persistent DOM, owned here ---
  // no `autoplay`: every start goes through play(), whose refusal we handle
  const audio = h("audio", { class: "call-audio" });
  audio.setAttribute("playsinline", "");
  audio.dataset.testid = "remote-audio";
  audio.addEventListener("playing", () => audio.srcObject?.getAudioTracks().length && setQuiet({ playing: true, playError: null, needsSound: false }));
  audio.addEventListener("pause", () => setQuiet({ playing: false }));
  const card = h("section", { class: "call-card", hidden: true, role: "region", "aria-label": "Voice call" });
  const announcer = h("div", { class: "sr-only", role: "status", "aria-live": "assertive" });
  document.body.append(card, audio, announcer);
  let drag = null; // desktop: where the user moved the card to, kept for this page

  const set = (patch) => {
    Object.assign(V, patch);
    paint();
    onChange();
  };
  // state changes that only the call window shows
  const setQuiet = (patch) => {
    let changed = false;
    for (const k in patch) if (V[k] !== patch[k]) changed = true;
    if (!changed) return;
    Object.assign(V, patch);
    paint();
  };
  const url = (callId, action) => `${base}/call/${callId}/${action}`;
  const post = (path, body = {}) => api(path, { method: "POST", body: { session, ...body } });

  function stopMedia() {
    clearTimeout(recoverTimer);
    clearTimeout(retryTimer);
    clearTimeout(graceTimer);
    clearTimeout(connectTimer);
    recoverTimer = retryTimer = graceTimer = connectTimer = null;
    clearInterval(tickTimer);
    tickTimer = null;
    clearTimeout(verifyTimer);
    verifyPlayback.retried = false;
    if (pc) {
      pc.onicecandidate = pc.ontrack = pc.onnegotiationneeded = pc.onconnectionstatechange = pc.oniceconnectionstatechange = null;
      pc.close();
    }
    pc = null;
    for (const t of stream?.getTracks() ?? []) t.stop();
    stream = null;
    for (const t of remote?.getTracks() ?? []) remote.removeTrack(t);
    remote = null;
    audio.pause();
    audio.srcObject = null;
    if (meter) meter.ctx.close().catch(() => {});
    meter = null;
    pendingCandidates = [];
    earlySignals = [];
    makingOffer = ignoreOffer = false;
    Object.assign(V, { micLevel: 0, peerLevel: 0, sending: null, receiving: null, playing: false, playError: null, needsSound: false, diag: null });
  }

  function finish(reason, { error = null } = {}) {
    if (V.callId) ended.add(V.callId);
    clearTimeout(ringTimer);
    stopMedia();
    set({ phase: "ended", callId: null, role: null, muted: false, peerMuted: false, endedReason: reason, error, elsewhere: false, connectedAt: null, minimized: false });
    announce(error ?? ENDED[reason] ?? "The call ended.");
  }

  function announce(text) {
    announcer.textContent = "";
    // a fresh text node each time, so the same message is announced again
    setTimeout(() => (announcer.textContent = text), 30);
  }

  async function microphone() {
    if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error("This browser can't make calls here. Calls need a secure (https) page."), { soft: true });
    try {
      // audio only, and only after an explicit Call or Accept
      return await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
    } catch (err) {
      const name = err?.name;
      const msg =
        name === "NotAllowedError" || name === "SecurityError"
          ? "Microphone access was blocked. Allow the microphone for this site in your browser settings, then try again."
          : name === "NotFoundError" || name === "OverconstrainedError"
            ? "No microphone was found. Connect one and try again."
            : name === "NotReadableError" || name === "AbortError"
              ? "Your microphone is being used by another app or tab. Close it there and try again."
              : "The microphone couldn't be started.";
      throw Object.assign(new Error(msg), { soft: true });
    }
  }

  async function iceConfig() {
    try {
      const cfg = await api(`${base}/call/ice`, { method: "POST", body: {} });
      V.relay = cfg.relay;
      return cfg.iceServers ?? [];
    } catch {
      return [];
    }
  }

  let peerStarting = false;
  async function startPeer(isPolite) {
    if (pc || peerStarting || !stream) return;
    peerStarting = true;
    polite = isPolite;
    const iceServers = await iceConfig();
    peerStarting = false;
    if (!stream || destroyed || V.phase === "ended" || V.elsewhere) return;
    const forceRelay = debug && new URLSearchParams(location.search).get("relay") === "1";
    if (forceRelay && !iceServers.some((s) => s.username)) return void hangup("no-relay");
    pc = new RTCPeerConnection({ iceServers, ...(forceRelay ? { iceTransportPolicy: "relay" } : {}) });
    for (const t of stream.getAudioTracks()) pc.addTrack(t, stream);
    pc.onicecandidate = ({ candidate }) => send({ kind: "candidate", candidate: candidate ? candidate.toJSON() : null });
    // Build our own stream from the received track: `streams` can be empty
    // (a sender that added the track without a stream), and swapping
    // srcObject on every event would restart playback.
    // A new MediaStream object each time the set of tracks changes: an
    // element whose srcObject gained a track later never loads it (it sits
    // "playing" at readyState 0, silent), so it's handed a fresh stream.
    pc.ontrack = ({ track }) => {
      if (track.kind !== "audio") return;
      const tracks = remote?.getAudioTracks() ?? [];
      if (!tracks.includes(track)) {
        remote = new MediaStream([...tracks.filter((t) => t.readyState === "live"), track]);
        audio.srcObject = remote;
      }
      audio.muted = false;
      audio.volume = 1;
      meterRemote();
      play();
    };
    // Only the caller offers. The callee's track goes out in its answer; if
    // it offered too (its addTrack fires negotiationneeded), its offer could
    // cross the caller's that it held while fetching ICE servers, and the
    // call would sit at "Connecting" with no candidates exchanged.
    pc.onnegotiationneeded = async () => {
      if (polite && !pc.remoteDescription) return;
      try {
        makingOffer = true;
        await pc.setLocalDescription();
        await send({ kind: "description", description: pc.localDescription });
      } catch {
        // a later negotiationneeded or ICE restart tries again
      } finally {
        makingOffer = false;
      }
    };
    pc.onconnectionstatechange = () => {
      if (!pc) return;
      const s = pc.connectionState;
      if (s === "connected") recovered();
      else if (s === "failed") recover();
      else if (s === "disconnected") {
        // often a short blip that ICE repairs itself; restart only if it doesn't
        clearTimeout(graceTimer);
        graceTimer = setTimeout(() => pc && pc.connectionState !== "connected" && recover(), GRACE_MS);
      }
    };
    clearTimeout(connectTimer);
    connectTimer = setTimeout(() => pc && V.phase === "connecting" && recover(), debug ? connectMs() : CONNECT_MS);
    startTicking();
    // anything the other side sent while we were fetching ICE servers
    for (const ev of earlySignals.splice(0)) await onSignal(ev);
  }

  // Inside the Call/Accept click: start the element on an empty stream, so
  // the page's later play() of the real one counts as user-initiated (some
  // browsers otherwise refuse it, seconds after the click, in ontrack).
  function unlockPlayback() {
    audio.srcObject = new MediaStream();
    audio.muted = false;
    audio.volume = 1;
    audio.play().catch(() => {});
  }

  // play() resolving isn't proof: confirm the element's clock moves.
  let verifyTimer = null;
  function verifyPlayback() {
    clearTimeout(verifyTimer);
    const t0 = audio.currentTime;
    verifyTimer = setTimeout(() => {
      if (!pc || !audio.srcObject?.getAudioTracks().length || V.needsSound) return;
      const stuck = audio.paused || audio.currentTime <= t0;
      if (!stuck) return setQuiet({ playError: null });
      // one retry with a fresh stream object, then say so
      if (!verifyPlayback.retried) {
        verifyPlayback.retried = true;
        audio.srcObject = new MediaStream(remote?.getAudioTracks() ?? []);
        return void play();
      }
      set({ playError: "The call is connected but its sound isn't playing. Press Turn on sound.", needsSound: true, minimized: false });
    }, 2500);
  }

  // Plays the remote stream. Called from ontrack and, when the browser
  // blocked autoplay, directly from the "Turn on sound" click.
  function play() {
    if (!audio.srcObject) return Promise.resolve(false);
    meter?.ctx.resume().catch(() => {});
    return audio.play().then(
      () => {
        setQuiet({ needsSound: false, playError: null });
        verifyPlayback();
        return true;
      },
      (err) => {
        // NotAllowedError: autoplay was blocked, a click will fix it.
        // Anything else is a real playback failure, and we say so.
        if (err?.name === "NotAllowedError") {
          set({ needsSound: true, minimized: false, playError: null });
          announce("Your browser blocked the call's sound. Press Turn on sound.");
        } else if (err?.name !== "AbortError") {
          set({ playError: "Your browser couldn't play the call's audio.", minimized: false });
        }
        return false;
      },
    );
  }

  // --- measured audio: level meters and RTP counters ---

  function analyser(track) {
    if (!meter) {
      const Ctx = window.AudioContext ?? window.webkitAudioContext;
      if (!Ctx) return null;
      meter = { ctx: new Ctx(), local: null, remote: null };
    }
    const src = meter.ctx.createMediaStreamSource(new MediaStream([track]));
    const an = meter.ctx.createAnalyser();
    an.fftSize = 1024;
    src.connect(an); // never to ctx.destination: the meter makes no sound
    return { an, buf: new Float32Array(an.fftSize), src };
  }
  function meterLocal() {
    const t = stream?.getAudioTracks()[0];
    if (t && !meter?.local) {
      const a = analyser(t);
      if (a) meter.local = a;
    }
  }
  function meterRemote() {
    const t = remote?.getAudioTracks()[0];
    if (t && !meter?.remote) {
      const a = analyser(t);
      if (a) meter.remote = a;
    }
  }
  const rms = (m) => {
    if (!m) return 0;
    m.an.getFloatTimeDomainData(m.buf);
    let s = 0;
    for (const x of m.buf) s += x * x;
    return Math.sqrt(s / m.buf.length);
  };

  let last = null; // previous RTP counters, to tell whether packets are moving
  function startTicking() {
    clearInterval(tickTimer);
    meterLocal();
    last = null;
    tickTimer = setInterval(tick, 250);
  }
  let statsBusy = false;
  let n = 0;
  async function tick() {
    if (destroyed || !pc) return;
    meter?.ctx.state === "suspended" && meter.ctx.resume().catch(() => {});
    V.micLevel = V.muted ? 0 : round(rms(meter?.local));
    V.peerLevel = round(rms(meter?.remote));
    paintLevels();
    setQuiet({ playing: !audio.paused && !audio.muted && audio.volume > 0 && audio.readyState >= 2 });
    if (++n % 4 || statsBusy) return; // RTP counters once a second
    statsBusy = true;
    const st = await api_.stats().catch(() => null);
    statsBusy = false;
    if (!st) return;
    const prev = last;
    last = st;
    const patch = {
      sending: prev ? st.packetsSent > prev.packetsSent : null,
      receiving: prev ? st.packetsReceived > prev.packetsReceived : null,
    };
    if (debug) patch.diag = `${st.localType ?? "?"}↔${st.remoteType ?? "?"} · in ${Math.round(st.bytesReceived / 1024)} KB · out ${Math.round(st.bytesSent / 1024)} KB · ${st.codec ?? "?"}${V.relay === false ? " · no TURN" : ""}`;
    setQuiet(patch);
  }
  const round = (x) => Math.round(x * 10_000) / 10_000;

  // What a person needs to know about the sound, in one line, from
  // measurements only. Silence from the other person isn't a fault.
  function audioState() {
    if (V.phase !== "connected") return null;
    if (V.needsSound) return { kind: "blocked", text: "Your browser blocked the sound. Press Turn on sound to hear them." };
    if (V.playError) return { kind: "error", text: V.playError };
    const mic = stream?.getAudioTracks()[0];
    if (!mic || mic.readyState === "ended") return { kind: "error", text: "Your microphone stopped. Hang up and call again." };
    if (V.receiving === false) return { kind: "warn", text: `No audio is arriving from ${V.peer?.displayName ?? "them"}. The connection may be blocked.` };
    if (V.sending === false && !V.muted) return { kind: "warn", text: "Your audio isn't being sent. The connection may be blocked." };
    if (V.peerMuted) return { kind: "info", text: `${V.peer?.displayName ?? "They"} muted their microphone.` };
    if (V.muted) return { kind: "info", text: "You're muted. They can't hear you." };
    return null;
  }

  // A dropped connection. The caller drives ICE restarts and retries them
  // (a restart offer sent while the network was down is simply lost); the
  // callee asks the caller for one. Both give up after RECOVER_MS with a
  // clear way to call again. Network and stream recovery trigger an
  // immediate retry (see `resume` and the browser's `online` event).
  let recoverStarted = 0;
  let retryTimer = null;
  let retries = 0;
  let graceTimer = null;
  function recover() {
    if (!pc || V.phase === "ended") return;
    clearTimeout(graceTimer);
    if (V.phase !== "reconnecting") {
      recoverStarted = Date.now();
      retries = 0;
      set({ phase: "reconnecting" });
    }
    if (!recoverTimer) {
      const limit = debug ? recoverMs() : RECOVER_MS;
      const check = () => {
        recoverTimer = null;
        if (!pc || V.phase !== "reconnecting") return;
        if (pc.connectionState === "connected" && pc.iceConnectionState !== "disconnected" && pc.iceConnectionState !== "checking") return recovered();
        if (Date.now() - recoverStarted >= limit) return void hangup(V.connectedAt ? "failed" : "never-connected");
        recoverTimer = setTimeout(check, 500);
      };
      recoverTimer = setTimeout(check, 500);
    }
    restartNow();
  }

  // One ICE restart attempt, then the next one scheduled.
  async function restartNow() {
    clearTimeout(retryTimer);
    retryTimer = null;
    if (!pc || V.phase !== "reconnecting") return;
    if (polite) {
      send({ kind: "restart" });
    } else {
      // Each attempt makes and sends its own restart offer: after a failed
      // attempt, a repeated restartIce() doesn't fire negotiationneeded again.
      try {
        // The very first offer, unanswered (it or its answer was lost): send
        // it again. The callee may already have applied it, and a new first
        // offer made after a rollback doesn't match it, so it would refuse it.
        if (pc.signalingState === "have-local-offer" && !pc.currentRemoteDescription) {
          await send({ kind: "description", description: pc.localDescription }, { throwOnFail: true });
        } else {
          // a restart offer whose answer never came (lost while offline)
          // would block the next one: roll it back first
          if (pc.signalingState === "have-local-offer") await pc.setLocalDescription({ type: "rollback" });
          if (pc.signalingState === "stable" && !makingOffer) {
            makingOffer = true;
            try {
              await pc.setLocalDescription(await pc.createOffer({ iceRestart: true }));
              await send({ kind: "description", description: pc.localDescription }, { throwOnFail: true });
            } finally {
              makingOffer = false;
            }
          }
        }
      } catch {
        // offline or a collision: the next retry tries again
      }
    }
    const delay = RETRY_MS[Math.min(retries, RETRY_MS.length - 1)];
    retries++;
    retryTimer = setTimeout(restartNow, delay);
  }

  function recovered() {
    clearTimeout(recoverTimer);
    clearTimeout(retryTimer);
    clearTimeout(graceTimer);
    clearTimeout(connectTimer);
    recoverTimer = retryTimer = graceTimer = connectTimer = null;
    set({ phase: "connected", error: null, connectedAt: V.connectedAt ?? Date.now() });
  }

  // the network came back: don't wait for the next scheduled retry
  const onOnline = () => V.phase === "reconnecting" && restartNow();
  addEventListener("online", onOnline);

  async function send(msg, { throwOnFail = false } = {}) {
    if (!V.callId) return;
    try {
      await post(url(V.callId, "signal"), msg);
    } catch (err) {
      if (err.status === 404) finish("ended");
      else if (throwOnFail) throw err;
    }
  }

  async function onDescription(description) {
    // an answer to an offer we resent, after the first answer already landed
    if (description.type === "answer" && pc.signalingState === "stable") return;
    const collision = description.type === "offer" && (makingOffer || pc.signalingState !== "stable");
    ignoreOffer = !polite && collision;
    if (ignoreOffer) return;
    await pc.setRemoteDescription(description);
    for (const c of pendingCandidates.splice(0)) await pc.addIceCandidate(c).catch(() => {});
    if (description.type === "offer") {
      await pc.setLocalDescription();
      await send({ kind: "description", description: pc.localDescription });
    }
  }

  async function onCandidate(candidate) {
    if (!pc.remoteDescription) return void pendingCandidates.push(candidate);
    try {
      await pc.addIceCandidate(candidate);
    } catch (err) {
      if (!ignoreOffer) throw err;
    }
  }

  async function onSignal(ev) {
    if (!pc) return;
    if (ev.kind === "restart") {
      // the callee lost its connection; this side may still think it's fine
      if (!polite) recover();
      return;
    }
    try {
      if (ev.kind === "description") await onDescription(ev.description);
      else if (ev.kind === "candidate" && ev.candidate) await onCandidate(ev.candidate);
    } catch {
      recover();
    }
  }

  // --- events from the stream ---

  async function handle(ev) {
    if (destroyed || !ev?.callId || ended.has(ev.callId)) return;
    // The answer, its offer and candidates can all beat the response to our
    // own Call request (or, when we both called, its merge). Until that tells
    // us the call id, hold them; call() replays them once it does.
    if (V.phase === "outgoing" && !V.callId && ev.type !== "invite" && ev.type !== "outgoing") return void beforeCallId.push(ev);
    const lastSeq = seenSeq.get(ev.callId) ?? 0;
    if (ev.seq <= lastSeq) return; // duplicate or replayed
    seenSeq.set(ev.callId, ev.seq);
    const mine = ev.callId === V.callId;

    switch (ev.type) {
      case "invite":
        if (V.callId && !mine) return;
        // we're calling them at this same moment: our invite will merge into this one
        if (V.phase === "outgoing" && !V.callId && V.peer?.id === ev.peer.id) return void seenSeq.delete(ev.callId);
        clearTimeout(ringTimer);
        ringTimer = setTimeout(() => V.phase === "incoming" && V.callId === ev.callId && finish("no-answer"), Math.max(1000, ev.expiresAt - Date.now()));
        set({ phase: "incoming", callId: ev.callId, peer: ev.peer, role: "callee", error: null, endedReason: null, elsewhere: false, lastPeerId: ev.peer.id, minimized: false });
        return announce(`${ev.peer.displayName} is calling you. Accept or decline in the call window.`);
      case "outgoing":
        if (ev.session !== session) return set({ phase: "idle", callId: ev.callId, peer: ev.peer, elsewhere: true });
        return;
      case "elsewhere":
        return set({ callId: ev.callId, peer: ev.peer, elsewhere: true, phase: "idle" });
      case "accepted":
        clearTimeout(ringTimer);
        if (ev.session !== session) {
          // answered (or being held) in another of this person's tabs
          stopMedia();
          return set({ phase: "idle", callId: ev.callId, peer: ev.peer, elsewhere: true });
        }
        if (!mine || !stream) return;
        set({ phase: "connecting" });
        // the caller makes the offer, via negotiationneeded
        return startPeer(ev.role === "callee");
      case "resume":
        // this tab's stream reconnected and still holds the call: anything
        // sent while it was down is lost, so retry now
        if (!mine || !pc) return;
        if (V.phase === "reconnecting") restartNow();
        else if (pc.connectionState !== "connected") recover();
        return;
      case "signal":
        if (!mine) return;
        // the offer can beat our own peer connection here (it's still
        // fetching ICE servers): hold it rather than drop it
        if (!pc) return void earlySignals.push(ev);
        return onSignal(ev);
      case "mute":
        if (mine) set({ peerMuted: ev.muted });
        return;
      case "ended":
        if (V.elsewhere && V.callId === ev.callId) {
          ended.add(ev.callId);
          return set({ phase: "idle", callId: null, peer: null, elsewhere: false });
        }
        if (!mine) return void ended.add(ev.callId);
        return finish(ev.reason);
    }
  }

  // --- actions ---

  async function call(member) {
    if (V.callId) return;
    unlockPlayback();
    set({ phase: "outgoing", peer: { id: member.id, displayName: member.displayName }, error: null, endedReason: null, lastPeerId: member.id, role: "caller", minimized: false });
    try {
      stream = await microphone();
      const res = await post(`${base}/call`, { to: member.id });
      if (destroyed) return stopMedia();
      let started = null;
      if (res.merged) {
        // they called us at the same moment: this is now their call, answered
        set({ callId: res.callId, peer: res.peer, role: "callee", phase: "connecting" });
        started = startPeer(true);
      } else {
        set({ callId: res.callId, peer: res.peer });
      }
      await replayHeld();
      return started;
    } catch (err) {
      // someone's call reached us while we were starting ours: keep showing it
      if (V.phase === "incoming") return replayHeld();
      stopMedia();
      set({ phase: "idle", callId: null, error: err.message, minimized: false });
      return replayHeld();
    }
  }

  async function replayHeld() {
    for (const ev of beforeCallId.splice(0)) await handle(ev);
  }

  async function accept() {
    if (V.phase !== "incoming") return;
    const callId = V.callId;
    clearTimeout(ringTimer);
    unlockPlayback();
    set({ phase: "connecting", error: null });
    try {
      stream = await microphone();
      await post(url(callId, "accept"));
      // the `accepted` event starts the peer connection
    } catch (err) {
      stopMedia();
      if (err.soft) post(url(callId, "decline")).catch(() => {});
      finish(err.status === 409 || err.status === 404 ? "answered-elsewhere" : "error", { error: err.message });
    }
  }

  async function decline() {
    if (V.phase !== "incoming") return;
    const callId = V.callId;
    finish("declined-by-me");
    await post(url(callId, "decline")).catch(() => {});
  }

  async function hangup(reason = "hangup") {
    const callId = V.callId;
    if (!callId || V.elsewhere) return;
    finish(reason === "failed" || reason === "never-connected" || reason === "no-relay" ? reason : "left");
    await post(url(callId, "hangup")).catch(() => {});
  }

  function toggleMute() {
    if (!stream) return;
    const muted = !V.muted;
    for (const t of stream.getAudioTracks()) t.enabled = !muted;
    set({ muted });
    send({ kind: "mute", muted });
  }

  // a full page leave: best effort, the server's grace timer covers the rest
  function leaveNow() {
    if (V.callId && !V.elsewhere) {
      const body = JSON.stringify({ session });
      fetch(url(V.callId, "hangup"), { method: "POST", credentials: "same-origin", keepalive: true, headers: { "content-type": "application/json" }, body }).catch(() => {});
    }
    stopMedia();
  }

  // --- view ---

  const LABEL = { outgoing: "Calling…", incoming: "Incoming call", connecting: "Connecting…", connected: "Connected", reconnecting: "Reconnecting…", ended: "Call ended" };
  const ENDED = {
    declined: "They declined the call.",
    "declined-by-me": "Call declined.",
    "no-answer": "No answer.",
    cancelled: "The call was cancelled.",
    hangup: "The call ended.",
    left: "You left the call.",
    disconnected: "The call dropped.",
    failed: "The connection was lost and couldn't be recovered.",
    "never-connected": "The call couldn't connect. Check your network and call again.",
    removed: "The call ended because someone is no longer on this trip.",
    "signed-out": "The call ended.",
    "answered-elsewhere": "That call was answered in another tab.",
    "time-limit": "The call reached its time limit.",
    "server-restart": "The call ended because the server restarted.",
    error: "The call couldn't start.",
    "no-relay": "Relay test: no TURN relay is configured on this server.",
    ended: "The call ended.",
  };
  const live = () => ["outgoing", "connecting", "connected", "reconnecting"].includes(V.phase);
  const clock = (ms) => {
    const s = Math.max(0, Math.floor(ms / 1000));
    const hh = Math.floor(s / 3600);
    const mm = String(Math.floor((s % 3600) / 60)).padStart(hh ? 2 : 1, "0");
    return `${hh ? `${hh}:` : ""}${mm}:${String(s % 60).padStart(2, "0")}`;
  };

  // The trip bar's part: a button to start a call, or a short pointer to
  // the call window while one is on. Never the controls themselves.
  function render() {
    const online = getPresence().filter((p) => p.id !== me.id);
    const box = h("div", { class: `call call-${V.phase}`, "data-phase": V.phase, role: "group", "aria-label": "Voice call" });
    const add = (...kids) => box.append(fill(document.createDocumentFragment(), ...kids));

    if (V.elsewhere) {
      add(h("span", { class: "call-status" }, `In a call with ${V.peer?.displayName ?? "someone"} in another tab`));
      return box;
    }
    if (live() || V.phase === "incoming") {
      add(
        h(
          "button",
          { class: `btn btn-sm call-pill call-pill-${V.phase}`, type: "button", "data-call": "show", "aria-label": `${LABEL[V.phase]} ${V.peer?.displayName ?? ""}. Show the call window`, onclick: restore },
          h("span", { class: "call-dot", "aria-hidden": "true" }),
          h("span", { class: "hide-sm" }, LABEL[V.phase]),
        ),
      );
      return box;
    }
    const target = online.find((p) => p.id === V.lastPeerId) ?? online[0];
    if (target) {
      const label = V.phase === "ended" && V.endedReason !== "left" && V.endedReason !== "declined-by-me" ? "Call again" : online.length > 1 ? "Call…" : `Call ${target.displayName}`;
      add(
        h(
          "button",
          {
            class: "btn btn-ghost btn-sm",
            type: "button",
            "data-call": "start",
            "aria-label": online.length > 1 ? "Start a voice call" : `Start a voice call with ${target.displayName}`,
            onclick: () => (online.length > 1 ? choose(online) : call(target)),
          },
          ico("phone"),
          h("span", { class: online.length > 1 ? "" : "hide-sm" }, label),
        ),
      );
    }
    return box.childNodes.length ? box : null;
  }

  function minimize() {
    set({ minimized: true });
    card.querySelector("[data-call=restore]")?.focus();
  }
  function restore() {
    set({ minimized: false });
    card.querySelector("[data-call=minimize]")?.focus();
  }
  function dismiss() {
    set({ phase: "idle", error: null, endedReason: null });
  }

  // The call window: built once per state change, into the same element.
  // Focus stays where it was unless the focused control is rebuilt.
  function paint() {
    if (destroyed) return;
    const showEnded = V.phase === "ended" || (V.phase === "idle" && V.error);
    const visible = !V.elsewhere && (live() || V.phase === "incoming" || showEnded);
    card.hidden = !visible;
    if (!visible) return void card.replaceChildren();
    const focused = document.activeElement && card.contains(document.activeElement) ? document.activeElement.dataset.call : null;

    const mini = V.minimized && live();
    card.className = `call-card call-${V.phase}${mini ? " is-mini" : ""}${drag ? " is-moved" : ""}`;
    card.dataset.phase = V.phase;
    if (drag && !mini) Object.assign(card.style, { left: `${drag.x}px`, top: `${drag.y}px`, right: "auto", bottom: "auto" });
    else Object.assign(card.style, { left: "", top: "", right: anchorRight(), bottom: "" });

    const who = V.peer ?? { id: "?", displayName: "Someone" };
    const timer = V.phase === "connected" && V.connectedAt ? h("span", { class: "call-timer", "data-call": "timer" }, clock(Date.now() - V.connectedAt)) : null;
    const state = audioState();
    const muteBtn = stream && (V.phase === "connected" || V.phase === "reconnecting" || V.phase === "connecting")
      && h(
        "button",
        { class: `call-btn call-mute${V.muted ? " on" : ""}`, type: "button", "data-call": "mute", "aria-pressed": String(V.muted), "aria-label": V.muted ? "Unmute your microphone" : "Mute your microphone", onclick: toggleMute },
        ico(V.muted ? "micOff" : "mic"),
        h("span", {}, V.muted ? "Unmute" : "Mute"),
      );
    const hangBtn = h(
      "button",
      { class: "call-btn call-hang", type: "button", "data-call": "hangup", "aria-label": V.phase === "outgoing" ? "Cancel the call" : "Hang up", onclick: () => hangup() },
      ico("hang"),
      h("span", {}, V.phase === "outgoing" ? "Cancel" : "Hang up"),
    );
    const soundBtn = V.needsSound && h(
      "button",
      { class: "call-btn call-sound", type: "button", "data-call": "sound", onclick: () => play() },
      ico("sound"),
      h("span", {}, "Turn on sound"),
    );

    if (mini) {
      fill(
        card,
        h(
          "div",
          { class: "call-mini" },
          h("button", { class: "call-mini-open", type: "button", "data-call": "restore", "aria-label": `Show the call with ${who.displayName}`, onclick: restore },
            h("span", { class: "call-dot", "aria-hidden": "true" }),
            h("span", { class: "call-mini-text" }, h("b", {}, who.displayName), " ", h("span", { class: "call-mini-state" }, timer ?? LABEL[V.phase])),
            ico("max")),
          soundBtn,
          muteBtn,
          hangBtn,
        ),
      );
    } else {
      const head = h(
        "header",
        { class: "call-head", onpointerdown: startDrag },
        h("span", { class: "call-head-label" }, h("span", { class: "call-dot", "aria-hidden": "true" }), V.phase === "incoming" ? "Incoming voice call" : "Voice call"),
        live() && h("button", { class: "call-icon-btn", type: "button", "data-call": "minimize", "aria-label": "Minimize the call window", onclick: minimize }, ico("min")),
        showEnded && h("button", { class: "call-icon-btn", type: "button", "data-call": "dismiss", "aria-label": "Close", onclick: dismiss }, "×"),
      );
      const body = h(
        "div",
        { class: "call-body" },
        h("div", { class: "call-face", "data-call": "peer-face" }, avatar(who, "lg")),
        h(
          "div",
          { class: "call-who" },
          h("strong", { class: "call-name" }, who.displayName),
          h(
            "span",
            { class: "call-state", role: "status", "data-call": "state" },
            V.phase === "ended" || showEnded ? (V.error ?? ENDED[V.endedReason] ?? "The call ended.") : LABEL[V.phase],
            timer && " · ",
            timer,
          ),
        ),
      );
      const meters = V.phase === "connected" && h(
        "div",
        { class: "call-meters", "aria-hidden": "true" },
        level("You", "me"),
        level(who.displayName, "peer"),
      );
      const note = state && h("p", { class: `call-note call-note-${state.kind}`, role: state.kind === "info" ? null : "alert", "data-call": "note" }, state.text);
      const actions =
        V.phase === "incoming"
          ? h(
              "div",
              { class: "call-actions" },
              h("button", { class: "call-btn call-decline", type: "button", "data-call": "decline", onclick: decline }, ico("hang"), h("span", {}, "Decline")),
              h("button", { class: "call-btn call-accept", type: "button", "data-call": "accept", onclick: accept }, ico("phone"), h("span", {}, "Accept")),
            )
          : live()
            ? h("div", { class: "call-actions" }, soundBtn, muteBtn, hangBtn)
            : showEnded && callAgainButton();
      const privacy = V.phase === "incoming" && h("p", { class: "call-fine" }, "Audio only, between the two of you. Nothing is recorded.");
      const diag = debug && V.diag && h("details", { class: "call-debug" }, h("summary", {}, "Connection details"), h("span", { class: "call-diag", "data-call": "diag" }, V.diag));
      fill(card, head, body, meters, note, privacy, actions, diag);
    }
    if (focused) card.querySelector(`[data-call="${focused}"]`)?.focus();
    paintLevels();
    keepInside();
  }

  // RMS on a log scale (-60..0 dBFS), so speech fills most of the bar
  const pct = (value) => Math.max(0, Math.min(100, Math.round((((value > 0 ? 20 * Math.log10(value) : -100) + 60) / 60) * 100)));
  function level(label, key) {
    return h(
      "div",
      { class: "call-level", "data-call": `level-${key}`, "data-level": "0" },
      h("span", { class: "call-level-label" }, label),
      h("span", { class: "call-level-bar" }, h("span", { class: "call-level-fill" })),
    );
  }
  // the meters and speaking rings move in place, without rebuilding buttons
  function paintLevels() {
    if (card.hidden) return;
    const connected = V.phase === "connected";
    const peer = connected && !V.peerMuted ? V.peerLevel : 0;
    const mine = connected && !V.muted ? V.micLevel : 0;
    for (const [key, value] of [["me", mine], ["peer", peer]]) {
      const el = card.querySelector(`[data-call=level-${key}]`);
      if (!el) continue;
      el.dataset.level = String(value);
      el.classList.toggle("speaking", value > SPEAKING);
      el.querySelector(".call-level-fill").style.width = `${pct(value)}%`;
    }
    card.querySelector("[data-call=peer-face]")?.classList.toggle("speaking", peer > SPEAKING);
  }

  function callAgainButton() {
    const online = getPresence().filter((p) => p.id !== me.id);
    const target = online.find((p) => p.id === V.lastPeerId);
    if (!target || V.endedReason === "left" || V.endedReason === "declined-by-me") return null;
    return h("div", { class: "call-actions" }, h("button", { class: "call-btn call-accept", type: "button", "data-call": "again", onclick: () => call(target) }, ico("phone"), h("span", {}, "Call again")));
  }

  // desktop only: move the card by its header, kept inside the window
  function startDrag(e) {
    if (e.button !== 0 || e.target.closest("button") || matchMedia("(max-width: 899px)").matches) return;
    const r = card.getBoundingClientRect();
    const dx = e.clientX - r.left;
    const dy = e.clientY - r.top;
    card.setPointerCapture?.(e.pointerId);
    const move = (ev) => {
      drag = clamp(ev.clientX - dx, ev.clientY - dy);
      Object.assign(card.style, { left: `${drag.x}px`, top: `${drag.y}px`, right: "auto", bottom: "auto" });
      card.classList.add("is-moved");
    };
    const up = () => {
      card.removeEventListener("pointermove", move);
      card.removeEventListener("pointerup", up);
      card.removeEventListener("pointercancel", up);
    };
    card.addEventListener("pointermove", move);
    card.addEventListener("pointerup", up);
    card.addEventListener("pointercancel", up);
  }
  const clamp = (x, y) => {
    const r = card.getBoundingClientRect();
    return { x: Math.round(Math.min(Math.max(8, x), innerWidth - r.width - 8)), y: Math.round(Math.min(Math.max(8, y), innerHeight - r.height - 8)) };
  };
  // Desktop: over the map's bottom-right corner, clear of the map's own
  // buttons and of the plan pane beside it. Phones place it with CSS.
  function anchorRight() {
    if (matchMedia("(max-width: 899px)").matches) return "";
    const map = document.querySelector(".pane-map");
    if (!map) return "";
    const r = map.getBoundingClientRect();
    return r.width > 480 ? `${Math.round(innerWidth - r.right + 76)}px` : "";
  }
  function keepInside() {
    if (!drag && !card.hidden) card.style.right = anchorRight();
    if (!drag || card.hidden || card.classList.contains("is-mini")) return;
    const c = clamp(drag.x, drag.y);
    if (c.x !== drag.x || c.y !== drag.y) {
      drag = c;
      Object.assign(card.style, { left: `${c.x}px`, top: `${c.y}px` });
    }
  }
  addEventListener("resize", keepInside);

  // the timer and meters move without a state change
  const clockTimer = setInterval(() => {
    if (V.phase === "connected" && !card.hidden) {
      const t = card.querySelector("[data-call=timer]");
      if (t && V.connectedAt) t.textContent = clock(Date.now() - V.connectedAt);
    }
  }, 1000);

  function choose(online) {
    const dialog = h(
      "dialog",
      { class: "dialog" },
      h("h2", {}, "Voice call"),
      h("p", { class: "muted small" }, "Audio only, between the two of you. Nothing is recorded or sent to the AI."),
      h(
        "div",
        { class: "call-pick" },
        online.map((p) =>
          h("button", { class: "btn btn-ghost", type: "button", onclick: () => { dialog.close(); call(p); } }, avatar(p, "sm"), p.displayName),
        ),
      ),
      h("div", { class: "dialog-actions" }, h("button", { class: "btn btn-ghost", type: "button", onclick: () => dialog.close() }, "Cancel")),
    );
    dialog.addEventListener("close", () => dialog.remove());
    document.body.append(dialog);
    dialog.showModal();
  }

  // Someone in the call left the trip's member list: end it on this side too.
  function membersChanged() {
    if (V.callId && V.peer && !getMembers().some((m) => m.id === V.peer.id)) finish("removed");
  }

  addEventListener("pagehide", leaveNow);

  const api_ = {
    state: V,
    handle,
    render,
    call,
    accept,
    decline,
    hangup,
    toggleMute,
    minimize,
    restore,
    membersChanged,
    // the stream dropped: media may still flow; the server holds the call
    // for a grace period and sends `resume` when the stream is back
    streamLost() {},
    destroy() {
      if (destroyed) return;
      removeEventListener("pagehide", leaveNow);
      removeEventListener("resize", keepInside);
      removeEventListener("online", onOnline);
      clearTimeout(ringTimer);
      clearInterval(clockTimer);
      leaveNow();
      destroyed = true;
      card.remove();
      audio.remove();
      announcer.remove();
    },
    // for tests and the debug panel only
    stats: async () => {
      if (!pc) return null;
      const report = await pc.getStats();
      let pair = null;
      let inbound = null;
      let outbound = null;
      const byId = new Map();
      report.forEach((r) => byId.set(r.id, r));
      report.forEach((r) => {
        if (r.type === "transport" && r.selectedCandidatePairId) pair = byId.get(r.selectedCandidatePairId);
        if (r.type === "inbound-rtp" && r.kind === "audio") inbound = r;
        if (r.type === "outbound-rtp" && r.kind === "audio") outbound = r;
      });
      if (!pair) report.forEach((r) => r.type === "candidate-pair" && r.nominated && r.state === "succeeded" && (pair = r));
      const local = pair && byId.get(pair.localCandidateId);
      const remoteC = pair && byId.get(pair.remoteCandidateId);
      const codec = (inbound?.codecId && byId.get(inbound.codecId)) || (outbound?.codecId && byId.get(outbound.codecId));
      const tx = pc.getTransceivers().find((t) => t.receiver.track?.kind === "audio");
      return {
        connectionState: pc.connectionState,
        localType: local?.candidateType ?? null,
        remoteType: remoteC?.candidateType ?? null,
        bytesReceived: inbound?.bytesReceived ?? 0,
        bytesSent: outbound?.bytesSent ?? 0,
        packetsReceived: inbound?.packetsReceived ?? 0,
        packetsSent: outbound?.packetsSent ?? 0,
        audioLevel: inbound?.audioLevel ?? null,
        totalAudioEnergy: inbound?.totalAudioEnergy ?? null,
        codec: codec?.mimeType?.replace("audio/", "") ?? null,
        direction: tx?.currentDirection ?? null,
      };
    },
    // test-only peek, never used by the app
    _simulateDrop: () => recover(),
    _pc: () => pc,
    // closes the media path for real, so ICE can't recover
    _breakMedia: () => { for (const t of pc?.getTransceivers() ?? []) t.stop(); pc && (pc.onconnectionstatechange = null); recover(); },
    _debug: () => ({
      tracks: stream?.getTracks().map((t) => ({ enabled: t.enabled, state: t.readyState })) ?? null,
      senders: pc?.getSenders().map((s) => ({ enabled: s.track?.enabled ?? null, same: stream?.getTracks().includes(s.track) })) ?? null,
      audio: { paused: audio.paused, muted: audio.muted, volume: audio.volume, readyState: audio.readyState, currentTime: audio.currentTime, connected: audio.isConnected, hasStream: Boolean(audio.srcObject), remoteTracks: remote?.getTracks().map((t) => ({ state: t.readyState, muted: t.muted })) ?? [] },
      levels: { mic: V.micLevel, peer: V.peerLevel },
      sending: V.sending,
      receiving: V.receiving,
    }),
  };
  if (debug) window.__wlVoice = api_;
  paint();
  return api_;
}
