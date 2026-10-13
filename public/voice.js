import { api, avatar, fill, h } from "/ui.js";

// Two-person voice calls between people on the same trip (ADR 0004).
// Signalling: authenticated POSTs out, targeted `call` events in on the
// trip's existing event stream. Media: native WebRTC, audio only, directly
// between the two browsers or through a TURN relay. Nothing is recorded,
// transcribed or sent to the AI.
//
// Negotiation follows MDN's "perfect negotiation": the callee is polite,
// the caller impolite, so simultaneous offers resolve the same way on both
// sides. Candidates that arrive before the remote description are queued.

const RECOVER_MS = 15_000;
const recoverMs = () => Number(new URLSearchParams(location.search).get("recoverms")) || RECOVER_MS;

export function createVoice({ base, session, me, getMembers, getPresence, onChange, debug = false }) {
  // phase: idle | outgoing | incoming | connecting | connected | reconnecting | ended
  const V = { phase: "idle", callId: null, peer: null, role: null, muted: false, peerMuted: false, error: null, endedReason: null, needsSound: false, elsewhere: false, lastPeerId: null, relay: null };
  let pc = null;
  let stream = null;
  let audio = null;
  let polite = false;
  let makingOffer = false;
  let ignoreOffer = false;
  let pendingCandidates = [];
  let seenSeq = new Map(); // callId -> highest seq handled
  let recoverTimer = null;
  let ringTimer = null;
  const ended = new Set(); // call ids that are over; anything later for them is ignored
  let destroyed = false;

  const set = (patch) => {
    Object.assign(V, patch);
    onChange();
  };
  const url = (callId, action) => `${base}/call/${callId}/${action}`;
  const post = (path, body = {}) => api(path, { method: "POST", body: { session, ...body } });

  function stopMedia() {
    clearTimeout(recoverTimer);
    recoverTimer = null;
    if (pc) {
      pc.onicecandidate = pc.ontrack = pc.onnegotiationneeded = pc.onconnectionstatechange = pc.oniceconnectionstatechange = null;
      pc.close();
    }
    pc = null;
    for (const t of stream?.getTracks() ?? []) t.stop();
    stream = null;
    if (audio) {
      audio.pause();
      audio.srcObject = null;
      audio.remove();
    }
    audio = null;
    pendingCandidates = [];
    makingOffer = ignoreOffer = false;
  }

  function finish(reason, { error = null } = {}) {
    if (V.callId) ended.add(V.callId);
    clearTimeout(ringTimer);
    stopMedia();
    set({ phase: "ended", callId: null, role: null, muted: false, peerMuted: false, needsSound: false, endedReason: reason, error, elsewhere: false });
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
    pc = new RTCPeerConnection({ iceServers, ...(forceRelay ? { iceTransportPolicy: "relay" } : {}) });
    for (const t of stream.getAudioTracks()) pc.addTrack(t, stream);
    pc.onicecandidate = ({ candidate }) => send({ kind: "candidate", candidate: candidate ? candidate.toJSON() : null });
    pc.ontrack = ({ streams, track }) => {
      if (!audio) {
        audio = h("audio", { autoplay: true, class: "call-audio" });
        audio.dataset.testid = "remote-audio";
        document.body.append(audio);
      }
      audio.srcObject = streams[0] ?? new MediaStream([track]);
      play();
    };
    pc.onnegotiationneeded = async () => {
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
      if (s === "connected") {
        clearTimeout(recoverTimer);
        recoverTimer = null;
        set({ phase: "connected", error: null });
      } else if (s === "disconnected" || s === "failed") {
        recover();
      }
    };
  }

  function play() {
    if (!audio) return;
    audio.play().then(
      () => V.needsSound && set({ needsSound: false }),
      () => set({ needsSound: true }), // autoplay blocked: show "Turn on sound"
    );
  }

  // A dropped connection: restart ICE (the impolite side drives it) and give
  // up after RECOVER_MS with a clear way to call again.
  function recover() {
    if (!pc || V.phase === "ended") return;
    if (V.phase !== "reconnecting") set({ phase: "reconnecting" });
    if (!polite) pc.restartIce();
    if (!recoverTimer) {
      const started = Date.now();
      const limit = debug ? recoverMs() : RECOVER_MS;
      // the connection may come back without a state change event (the
      // restart succeeded on a path that never fully dropped), so check
      const tick = () => {
        recoverTimer = null;
        if (!pc || V.phase === "ended") return;
        if (pc.connectionState === "connected" && pc.iceConnectionState !== "disconnected" && pc.signalingState === "stable" && Date.now() - started > 500) return set({ phase: "connected", error: null });
        if (Date.now() - started >= limit) return void hangup("failed");
        recoverTimer = setTimeout(tick, 500);
      };
      recoverTimer = setTimeout(tick, 500);
    }
  }

  async function send(msg) {
    if (!V.callId) return;
    try {
      await post(url(V.callId, "signal"), msg);
    } catch (err) {
      if (err.status === 404) finish("ended");
    }
  }

  async function onDescription(description) {
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

  // --- events from the stream ---

  async function handle(ev) {
    if (destroyed || !ev?.callId || ended.has(ev.callId)) return;
    const last = seenSeq.get(ev.callId) ?? 0;
    if (ev.seq <= last) return; // duplicate or replayed
    seenSeq.set(ev.callId, ev.seq);
    const mine = ev.callId === V.callId;

    switch (ev.type) {
      case "invite":
        if (V.callId && !mine) return;
        // we're calling them at this same moment: our invite will merge into this one
        if (V.phase === "outgoing" && !V.callId && V.peer?.id === ev.peer.id) return void seenSeq.delete(ev.callId);
        clearTimeout(ringTimer);
        ringTimer = setTimeout(() => V.phase === "incoming" && V.callId === ev.callId && finish("no-answer"), Math.max(1000, ev.expiresAt - Date.now()));
        return set({ phase: "incoming", callId: ev.callId, peer: ev.peer, role: "callee", error: null, endedReason: null, elsewhere: false, lastPeerId: ev.peer.id });
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
        // this tab's stream reconnected and still holds the call
        if (mine && pc && pc.connectionState !== "connected") recover();
        return;
      case "signal":
        if (!mine || !pc) return;
        try {
          if (ev.kind === "description") await onDescription(ev.description);
          else if (ev.kind === "candidate" && ev.candidate) await onCandidate(ev.candidate);
        } catch {
          recover();
        }
        return;
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
    set({ phase: "outgoing", peer: { id: member.id, displayName: member.displayName }, error: null, endedReason: null, lastPeerId: member.id, role: "caller" });
    try {
      stream = await microphone();
      const res = await post(`${base}/call`, { to: member.id });
      if (destroyed) return stopMedia();
      if (res.merged) {
        // they called us at the same moment: this is now their call, answered
        set({ callId: res.callId, peer: res.peer, role: "callee", phase: "connecting" });
        return startPeer(true);
      }
      set({ callId: res.callId, peer: res.peer });
    } catch (err) {
      // someone's call reached us while we were starting ours: keep showing it
      if (V.phase === "incoming") return;
      stopMedia();
      set({ phase: "idle", callId: null, error: err.message });
    }
  }

  async function accept() {
    if (V.phase !== "incoming") return;
    const callId = V.callId;
    clearTimeout(ringTimer);
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
    finish(reason === "failed" ? "failed" : "left");
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

  const LABEL = { outgoing: "Calling…", incoming: "Incoming call", connecting: "Connecting…", connected: "Connected", reconnecting: "Reconnecting…" };
  const ENDED = {
    declined: "They declined the call.",
    "declined-by-me": "Call declined.",
    "no-answer": "No answer.",
    cancelled: "The call was cancelled.",
    hangup: "The call ended.",
    left: "You left the call.",
    disconnected: "The call dropped.",
    failed: "The connection was lost and couldn't be recovered.",
    removed: "The call ended because someone is no longer on this trip.",
    "signed-out": "The call ended.",
    "answered-elsewhere": "That call was answered in another tab.",
    "time-limit": "The call reached its time limit.",
    "server-restart": "The call ended because the server restarted.",
    error: "The call couldn't start.",
    ended: "The call ended.",
  };

  // Compact control for the trip bar.
  function render() {
    const online = getPresence().filter((p) => p.id !== me.id);
    const live = ["outgoing", "connecting", "connected", "reconnecting"].includes(V.phase);
    const box = h("div", { class: `call call-${V.phase}`, "data-phase": V.phase, role: "group", "aria-label": "Voice call" });
    // h()/fill() skip false and null children; the DOM's own append() would print them
    const add = (...kids) => box.append(fill(document.createDocumentFragment(), ...kids));

    if (V.elsewhere) {
      add(h("span", { class: "call-status" }, `In a call with ${V.peer?.displayName ?? "someone"} in another tab`));
      return box;
    }
    if (V.phase === "incoming") {
      add(
        h("span", { class: "call-status", role: "alert" }, avatar(V.peer, "sm"), h("span", {}, h("b", {}, V.peer.displayName), " is calling")),
        h("button", { class: "btn btn-primary btn-sm", type: "button", "data-call": "accept", onclick: accept }, "Accept"),
        h("button", { class: "btn btn-ghost btn-sm", type: "button", "data-call": "decline", onclick: decline }, "Decline"),
      );
      return box;
    }
    if (live) {
      const inCall = V.phase === "connected" || V.phase === "reconnecting";
      add(
        h(
          "span",
          { class: "call-status", role: "status", "aria-live": "polite" },
          h("span", { class: "call-dot", "aria-hidden": "true" }),
          h("span", { class: "call-label" }, LABEL[V.phase]),
          h("span", { class: "call-who hide-sm" }, inCall ? `You and ${V.peer?.displayName}${V.peerMuted ? " (muted)" : ""}` : V.peer?.displayName),
        ),
        V.needsSound && h("button", { class: "btn btn-dark btn-sm", type: "button", "data-call": "sound", onclick: play }, "Turn on sound"),
        stream && h("button", { class: `btn btn-sm ${V.muted ? "btn-dark" : "btn-ghost"}`, type: "button", "aria-pressed": String(V.muted), "data-call": "mute", onclick: toggleMute }, V.muted ? "Unmute" : "Mute"),
        h("button", { class: "btn btn-sm btn-hang", type: "button", "data-call": "hangup", onclick: () => hangup() }, V.phase === "outgoing" ? "Cancel" : "Leave"),
      );
      return box;
    }
    // idle or ended: offer to call whoever else is here
    const target = online.find((p) => p.id === V.lastPeerId) ?? online[0];
    if (V.phase === "ended" || V.error) {
      add(h("span", { class: `call-status small${V.error ? " call-error" : ""}`, role: "status" }, V.error ?? ENDED[V.endedReason] ?? "The call ended."));
    }
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
          h("span", { class: "call-ico", "aria-hidden": "true" }, "☏"),
          h("span", { class: online.length > 1 ? "" : "hide-sm" }, label),
        ),
      );
    } else if (V.phase === "ended" || V.error) {
      add(h("button", { class: "linklike small", type: "button", onclick: () => set({ phase: "idle", error: null, endedReason: null }) }, "Dismiss"));
    }
    return box.childNodes.length ? box : null;
  }

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
    membersChanged,
    // the stream dropped: media may still flow; the server holds the call
    // for a grace period and sends `resume` when the stream is back
    streamLost() {},
    destroy() {
      destroyed = true;
      removeEventListener("pagehide", leaveNow);
      clearTimeout(ringTimer);
      leaveNow();
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
      const remote = pair && byId.get(pair.remoteCandidateId);
      return {
        connectionState: pc.connectionState,
        localType: local?.candidateType ?? null,
        remoteType: remote?.candidateType ?? null,
        bytesReceived: inbound?.bytesReceived ?? 0,
        bytesSent: outbound?.bytesSent ?? 0,
        audioLevel: inbound?.audioLevel ?? null,
        totalAudioEnergy: inbound?.totalAudioEnergy ?? null,
      };
    },
    // test-only peek, never used by the app
    _simulateDrop: () => recover(),
    // closes the media path for real, so ICE can't recover
    _breakMedia: () => { for (const t of pc?.getTransceivers() ?? []) t.stop(); pc && (pc.onconnectionstatechange = null); recover(); },
    _debug: () => ({ tracks: stream?.getTracks().map((t) => ({ enabled: t.enabled, state: t.readyState })) ?? null, senders: pc?.getSenders().map((s) => ({ enabled: s.track?.enabled ?? null, same: stream?.getTracks().includes(s.track) })) ?? null }),
  };
  if (debug) window.__wlVoice = api_;
  return api_;
}
