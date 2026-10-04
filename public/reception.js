// Reception: how you get into the gym. Checking in for the first time (a name
// and a shirt colour), coming back with your gym pass, and a few lines on how
// the place works. Nothing about your history is shown here: that's kept in
// your locker.

import { esc, pad } from "./util.js";

export function doorHtml(view, { colours, me, message }) {
  if (view === "new") {
    return `<p class="eyebrow">Reception</p>
      <h1 id="door-title">Check in</h1>
      <p class="lede">A shared gym floor. Train on your own, alongside whoever else is in. You'll get a gym pass and a locker of your own.</p>
      <form id="join-form">
        <label class="field"><span>Your name in the gym</span><input name="name" maxlength="24" autocomplete="nickname" required /></label>
        <fieldset class="swatches"><legend>Your shirt</legend>${colours
          .map((c, i) => `<label style="--c:${c}"><input type="radio" name="colour" value="${c}"${i === 0 ? " checked" : ""} /><span class="sr">${c}</span></label>`)
          .join("")}</fieldset>
        <p class="error" role="alert">${esc(message)}</p>
        <button type="submit" class="primary">Walk in</button>
      </form>
      <button type="button" class="link" data-door="pass">Been here before? Use your gym pass</button>`;
  }
  if (view === "pass") {
    return `<p class="eyebrow">Reception</p>
      <h1 id="door-title">Come back in</h1>
      <p class="lede">Enter the gym pass you were given on your first visit.</p>
      <form id="pass-form">
        <label class="field"><span>Gym pass</span><input name="pass" placeholder="XXXX-XXXX-XXXX" autocomplete="off" autocapitalize="characters" required /></label>
        <p class="error" role="alert">${esc(message)}</p>
        <button type="submit" class="primary">Come back in</button>
      </form>
      <button type="button" class="link" data-door="new">I'm new here</button>`;
  }
  return `<p class="eyebrow">Reception</p>
    <h1 id="door-title">Welcome back, ${esc(me.user.name)}</h1>
    <p class="lede">${me.locker ? `Locker ${pad(me.locker)} is still yours. ` : ""}Walk back in and pick up where you like.</p>
    <p class="error" role="alert">${esc(message)}</p>
    <button type="button" class="primary" data-act="enter">Walk in</button>
    <button type="button" class="link" data-act="forget">Not ${esc(me.user.name)}? Start fresh</button>`;
}

// What reception hands you on the way in: your pass, your locker, and how
// the gym works. Shown once on checking in, and again from "Gym pass".
export function checkInCard(me) {
  return `<div class="pass-card">
    <p>Your gym pass</p>
    <code>${esc(me.pass)}</code>
    <p class="muted">This browser remembers you. On another device, use this pass to come back as yourself.</p>
    <ul class="howto">
      <li>Tap a free machine to set up a set, then <b>Start set</b>.</li>
      <li>${me.locker ? `Locker <b>${pad(me.locker)}</b> is yours, in the locker room by reception. Open it to see what you've done here.` : "The locker room is full right now; you'll get a locker when one frees up."}</li>
    </ul>
    <div class="row"><button type="button" class="link" data-act="hide-pass">Got it</button><button type="button" class="link" data-act="forget">Forget this device</button></div>
  </div>`;
}
